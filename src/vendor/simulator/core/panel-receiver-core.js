// Cymcast panel receiver — the WebRTC answerer half of the device simulator.
//
// Ported from the real Electron receiver (receiver-desktop/renderer:
// cloudlink.js + session.js + app.js), combined into one testable factory:
//  - CloudLink: WS to {cymcastUrl}/ws, panel-register (features + requestedCode),
//    reconnect backoff, message dispatch.
//  - ReceiverSession: RTCPeerConnection answerer with H.264 preference, pending
//    ICE buffering, and the resilience state machine (ICE disconnect > 8s / ICE
//    failed / decode-stall > 10s → `restart`, never `bye`).
//  - Orchestrator: peer adoption (preemption), grace-rebind resume, ride-out on
//    signaling loss.
//
// Every relayed message (answer/ice/restart/bye) is stamped with
// sessionId + sessionToken or the server drops it.

/* global RTCRtpTransceiver */
import { buildCymcastUrls } from './url-builder';
import {
  BASE_ICE_SERVERS,
  DISCONNECT_GRACE_MS,
  DECODE_STALL_MS,
  RESET_AFTER_RESTART_MS,
  STATS_INTERVAL_MS,
} from './constants';

const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const SHOW_PIN_DEFAULT_TTL_MS = 10 * 60000;

/**
 * Creates a Cymcast panel receiver bound to a Cymcast server.
 * @param {object} options - configuration
 * @param {string} options.cymcastUrl - Cymcast server base URL (http(s))
 * @param {string} options.panelSecret - PANEL_DEVICE_SECRET
 * @param {string} options.panelId - stable panel id (v2 register)
 * @param {string} [options.requestedCode] - room code to bind to (dev hook)
 * @param {boolean} [options.advertiseShowPin=true] - when false, the panel omits
 *   the show-pin feature at register (v2: casts are grant-authorized, no cast PIN)
 * @param {(function(): Promise<string>)|null} [options.getRegisterToken=null] -
 *   when set, register with a per-device token from this async fn instead of the
 *   device_secret (v3); the server derives panelId from the token's `sub`
 * @param {object} [options.callbacks] - onStatus, onRoom, onCastPin, onVideoTrack,
 *   onStats, onCasting, onError, onDataChannel(channel, pc, sessionId) for
 *   DataChannel-only control sessions
 * @param {function} [options.webSocketFactory] - WebSocket constructor (injectable)
 * @param {function} [options.peerConnectionFactory] - RTCPeerConnection factory (injectable)
 * @param {function} [options.now] - monotonic clock (injectable; defaults to performance.now)
 * @returns {object} receiver API: start(), stop(), dropSocket(), getState()
 */
export function createPanelReceiver({
  cymcastUrl,
  panelSecret,
  panelId,
  requestedCode = '',
  advertiseShowPin = true,
  getRegisterToken = null,
  callbacks,
  webSocketFactory,
  peerConnectionFactory,
  now,
}) {
  const noop = () => {};
  const cb = {
    onStatus: noop,
    onRoom: noop,
    onCastPin: noop,
    onVideoTrack: noop,
    onStats: noop,
    onCasting: noop,
    onError: noop,
    onDataChannel: noop,
    ...(callbacks || {}),
  };
  const WebSocketImpl = webSocketFactory || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  const createPeerConnection = peerConnectionFactory || ((cfg) => new RTCPeerConnection(cfg)); // eslint-disable-line no-undef
  const clock =
    now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const wsUrl = buildCymcastUrls(cymcastUrl).ws;

  let ws = null;
  let reconnectDelay = RECONNECT_INITIAL_MS;
  let reconnectTimer = null;
  let stopped = false;

  let session = null; // { dispose, acceptOffer, addRemoteCandidate, iceState }
  let sessionId = null;
  let sessionToken = null;
  let casting = false;

  // ---- signaling (CloudLink) ----

  function send(obj) {
    const OPEN = WebSocketImpl && typeof WebSocketImpl.OPEN === 'number' ? WebSocketImpl.OPEN : 1;
    if (ws && ws.readyState === OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function sendSession(obj) {
    // The server drops any relayed message missing its session binding.
    if (!sessionId || !sessionToken) return;
    send({ ...obj, sessionId, sessionToken });
  }

  const PANEL_INFO = {
    model: 'SIM',
    appVersion: '0.0',
    decode: { preferred: 'lb1080p60', fallback: [] },
  };

  function buildRegister() {
    const msg = {
      type: 'panel-register',
      deviceSecret: panelSecret,
      features: advertiseShowPin ? ['show-pin'] : [],
    };
    if (panelId) {
      msg.panelId = panelId;
      msg.panelInfo = PANEL_INFO;
    }
    if (requestedCode) msg.requestedCode = requestedCode;
    return msg;
  }

  // v3 token registration: authenticate with a per-device receiver token; the
  // server derives panelId from the token's `sub`, so no panelId/deviceSecret
  // is sent.
  function buildTokenRegister(token) {
    return {
      type: 'panel-register',
      token,
      features: advertiseShowPin ? ['show-pin'] : [],
      panelInfo: PANEL_INFO,
    };
  }

  // Sends the register message: token-based when getRegisterToken is set
  // (fetching a fresh token per register), else the device_secret path.
  async function register() {
    if (!getRegisterToken) {
      send(buildRegister());
      return;
    }
    try {
      const token = await getRegisterToken();
      send(buildTokenRegister(token));
    } catch (error) {
      cb.onError('register-token-failed', String((error && error.message) || error));
      scheduleReconnect();
    }
  }

  function connect() {
    if (stopped) return;
    cb.onStatus('cloud connecting');
    let socket;
    try {
      socket = new WebSocketImpl(wsUrl);
    } catch (_) {
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      cb.onStatus('cloud registering');
      void register();
      reconnectDelay = RECONNECT_INITIAL_MS;
    };
    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      dispatch(msg);
    };
    socket.onclose = () => {
      if (ws !== socket) return; // stale generation
      ws = null;
      // Signaling lost. If a cast is live, RIDE IT OUT — reconnect + re-register
      // rebinds within the server's grace window with no media interruption.
      if (!casting) cb.onStatus('connection lost');
      scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch (_) {
        /* noop */
      }
    };
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = reconnectDelay;
    cb.onStatus(`cloud reconnecting in ${Math.round(delay / 1000)}s`);
    reconnectTimer = setTimeout(connect, delay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function dispatch(msg) {
    switch (msg.type) {
      case 'room': {
        const r = msg.room || {};
        const room = {
          code: r.code || '',
          displayPin: r.displayPin || '',
          joinUrl: r.joinUrl || '',
        };
        const s = msg.session;
        const resumed =
          s && s.sessionId && s.sessionToken
            ? { sessionId: s.sessionId, sessionToken: s.sessionToken }
            : null;
        onRoom(room, resumed);
        break;
      }
      case 'peer':
        if (msg.peer !== 'sender') return;
        onPeer({
          sessionId: msg.sessionId,
          sessionToken: msg.sessionToken,
          iceServers: Array.isArray(msg.iceServers) ? msg.iceServers : [],
        });
        break;
      case 'offer':
        if (typeof msg.sdp === 'string') onOffer(msg.sessionId, msg.sdp);
        break;
      case 'ice':
        if (msg.candidate && typeof msg.candidate === 'object') {
          onIce(msg.sessionId, {
            candidate: msg.candidate.candidate || '',
            sdpMid: msg.candidate.sdpMid != null ? msg.candidate.sdpMid : '0',
            sdpMLineIndex: msg.candidate.sdpMLineIndex != null ? msg.candidate.sdpMLineIndex : 0,
          });
        }
        break;
      case 'bye':
        onBye(msg.sessionId || null);
        break;
      case 'show-pin':
        if (!casting)
          cb.onCastPin(typeof msg.ttlMs === 'number' ? msg.ttlMs : SHOW_PIN_DEFAULT_TTL_MS);
        break;
      case 'error':
        cb.onError(msg.code || '', msg.message || msg.code || 'error');
        break;
      default:
        break; // additive protocol: unknown types ignored (incl. "resumed")
    }
  }

  // ---- orchestration ----

  function resetSession(statusText) {
    if (session) session.dispose();
    session = null;
    sessionId = null;
    sessionToken = null;
    casting = false;
    cb.onVideoTrack(null);
    cb.onCasting(false);
    if (statusText) cb.onStatus(statusText);
  }

  function onRoom(room, resumed) {
    cb.onRoom(room);
    if (resumed && session && resumed.sessionId === sessionId) {
      cb.onStatus(casting ? 'receiving' : 'connected');
      return;
    }
    if (resumed && !session) {
      // Server holds a live session but we have no peer (re-register within grace):
      // adopt the ids so relayed messages validate; the sender's offer rebuilds media.
      sessionId = resumed.sessionId;
      sessionToken = resumed.sessionToken;
      cb.onStatus('ready to receive');
      return;
    }
    if (!resumed && session) {
      resetSession('ready to receive');
      return;
    }
    cb.onStatus('ready to receive');
  }

  function onPeer(peer) {
    // A new sessionId while one is live = preemption handoff: drop old, adopt new.
    if (session && peer.sessionId !== sessionId) resetSession(null);
    sessionId = peer.sessionId;
    sessionToken = peer.sessionToken;
    cb.onStatus('sender connected');
    session = createSession(peer.iceServers);
  }

  function onOffer(msgSessionId, sdp) {
    if (!session || (msgSessionId && msgSessionId !== sessionId)) return;
    cb.onStatus('connecting');
    session.acceptOffer(sdp).catch(() => {
      // NOT a bye — recovery is restart-shaped; the sender re-offers.
      cb.onStatus('connection failed');
    });
  }

  function onIce(msgSessionId, candidate) {
    if (!session || (msgSessionId && msgSessionId !== sessionId)) return;
    session.addRemoteCandidate(candidate);
  }

  function onBye(msgSessionId) {
    if (msgSessionId && sessionId && msgSessionId !== sessionId) return;
    resetSession('ready to receive');
  }

  // ---- receiver session (WebRTC answerer + resilience) ----

  function createSession(sessionIceServers) {
    let pc = null;
    let disposed = false;
    let pendingRemoteCandidates = [];
    let disconnectTimer = null;
    let resetDeadlineTimer = null;
    let stallTimer = null;
    let statsTimer = null;
    let stallRestartRequested = false;
    let lastFramesDecoded = -1;
    let lastFramesReceived = -1;
    let lastDecodeProgressAt = 0;

    function cancelResilienceTimers() {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
      clearTimeout(resetDeadlineTimer);
      resetDeadlineTimer = null;
      stallRestartRequested = false;
    }

    function closePc() {
      if (pc) {
        try {
          pc.close();
        } catch (_) {
          /* noop */
        }
      }
      pc = null;
    }

    function preferH264() {
      if (
        typeof RTCRtpReceiver === 'undefined' ||
        !RTCRtpReceiver.getCapabilities ||
        typeof RTCRtpTransceiver === 'undefined' ||
        !('setCodecPreferences' in RTCRtpTransceiver.prototype)
      ) {
        return;
      }
      const caps = RTCRtpReceiver.getCapabilities('video');
      if (!caps) return;
      const rank = (c) =>
        /h264/i.test(c.mimeType)
          ? 0
          : /vp8/i.test(c.mimeType)
          ? 1
          : /vp9/i.test(c.mimeType)
          ? 2
          : 3;
      for (const t of pc.getTransceivers()) {
        if (t.receiver && t.receiver.track && t.receiver.track.kind !== 'video') continue;
        try {
          t.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b)));
        } catch (_) {
          /* non-fatal */
        }
      }
    }

    function requestRestart(reason) {
      if (disposed) return;
      sendSession({ type: 'restart', reason });
      scheduleResetDeadline();
    }

    function scheduleResetDeadline() {
      if (resetDeadlineTimer) return;
      resetDeadlineTimer = setTimeout(() => {
        resetDeadlineTimer = null;
        if (disposed) return;
        const st = pc && pc.iceConnectionState;
        if (st === 'connected' || st === 'completed') return;
        resetSession('connection lost');
      }, RESET_AFTER_RESTART_MS);
    }

    function onIceDisconnected() {
      if (disconnectTimer || resetDeadlineTimer) return;
      disconnectTimer = setTimeout(() => {
        disconnectTimer = null;
        requestRestart('ice disconnected > 8s');
      }, DISCONNECT_GRACE_MS);
    }

    async function trackFramesProgress() {
      if (disposed || !pc) return;
      const stats = await pc.getStats().catch(() => null);
      if (!stats) return;
      let framesDecoded = -1;
      let framesReceived = -1;
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          framesDecoded = typeof r.framesDecoded === 'number' ? r.framesDecoded : -1;
          framesReceived = typeof r.framesReceived === 'number' ? r.framesReceived : -1;
        }
      });
      if (framesDecoded < 0) return;

      const decodedAdvanced = framesDecoded !== lastFramesDecoded;
      const receivedAdvanced = framesReceived !== lastFramesReceived;
      lastFramesDecoded = framesDecoded;
      lastFramesReceived = framesReceived;

      const t = clock();
      if (decodedAdvanced || !receivedAdvanced) {
        // Progress, or a static/idle source (both flat) which is NOT a stall.
        lastDecodeProgressAt = t;
        stallRestartRequested = false;
        return;
      }
      if (t - lastDecodeProgressAt > DECODE_STALL_MS && !stallRestartRequested) {
        stallRestartRequested = true;
        requestRestart('frames stalled > 10s');
      }
    }

    function startStatsLoop() {
      clearInterval(stallTimer);
      clearInterval(statsTimer);
      lastDecodeProgressAt = clock();
      stallTimer = setInterval(() => {
        void trackFramesProgress();
      }, STATS_INTERVAL_MS);
      statsTimer = setInterval(async () => {
        if (disposed || !pc) return;
        const stats = await pc.getStats().catch(() => null);
        if (!stats) return;
        const out = {};
        stats.forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            out.framesDecoded = r.framesDecoded;
            out.fps = r.framesPerSecond;
            out.res = `${r.frameWidth || 0}x${r.frameHeight || 0}`;
            out.dropped = r.framesDropped;
            out.decoder = r.decoderImplementation;
          }
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
            out.rttMs = Math.round((r.currentRoundTripTime || 0) * 1000);
          }
        });
        cb.onStats(out);
      }, STATS_INTERVAL_MS);
    }

    function createPc() {
      pc = createPeerConnection({
        iceServers: [...BASE_ICE_SERVERS, ...sessionIceServers],
        iceTransportPolicy: 'all',
      });

      pc.onicecandidate = (ev) => {
        if (disposed || !ev.candidate) return;
        sendSession({
          type: 'ice',
          candidate: {
            candidate: ev.candidate.candidate,
            sdpMid: ev.candidate.sdpMid,
            sdpMLineIndex: ev.candidate.sdpMLineIndex,
          },
        });
      };

      pc.ontrack = (ev) => {
        if (disposed) return;
        if (ev.track.kind === 'video') {
          const stream = (ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
          casting = true;
          cb.onVideoTrack(stream);
          cb.onCasting(true);
          cb.onStatus('receiving');
          startStatsLoop();
        }
      };

      // Control sessions carry no media: the sender opens DataChannels instead.
      pc.ondatachannel = (ev) => {
        if (disposed || !ev || !ev.channel) return;
        cb.onDataChannel(ev.channel, pc, sessionId);
      };

      pc.oniceconnectionstatechange = () => {
        if (disposed) return;
        const st = pc.iceConnectionState;
        if (st === 'connected' || st === 'completed') {
          cb.onStatus('connected');
          cancelResilienceTimers();
        } else if (st === 'disconnected') {
          cb.onStatus('ice disconnected');
          onIceDisconnected();
        } else if (st === 'failed') {
          requestRestart('ice failed');
        }
      };
    }

    async function acceptOffer(sdp) {
      if (disposed) return;
      cancelResilienceTimers();
      // A fresh offer over a live description = sender restart: rebuild the peer.
      if (pc && pc.remoteDescription) closePc();
      if (!pc) createPc();

      cb.onStatus('creating answer');
      await pc.setRemoteDescription({ type: 'offer', sdp });
      for (const c of pendingRemoteCandidates.splice(0)) {
        await pc.addIceCandidate(c).catch(() => {});
      }
      preferH264();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSession({ type: 'answer', sdp: pc.localDescription.sdp });
      cb.onStatus('answer sent');
    }

    async function addRemoteCandidate(candidate) {
      if (disposed) return;
      if (!pc || !pc.remoteDescription) {
        pendingRemoteCandidates.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    }

    function dispose() {
      disposed = true;
      cancelResilienceTimers();
      clearInterval(stallTimer);
      clearInterval(statsTimer);
      closePc();
    }

    return {
      acceptOffer,
      addRemoteCandidate,
      dispose,
      iceState: () => (pc ? pc.iceConnectionState : null),
    };
  }

  // ---- public API ----

  function start() {
    stopped = false;
    connect();
  }

  function stop() {
    stopped = true;
    clearTimeout(reconnectTimer);
    if (session) session.dispose();
    session = null;
    sessionId = null;
    sessionToken = null;
    casting = false;
    if (ws) {
      try {
        ws.close();
      } catch (_) {
        /* already dead */
      }
    }
    ws = null;
  }

  // Fault-injection hook for the e2e harness (drop the signaling socket to
  // exercise ride-out + grace rebind). Does not change protocol behavior.
  function dropSocket() {
    if (ws) {
      try {
        ws.close();
      } catch (_) {
        /* noop */
      }
    }
  }

  return {
    start,
    stop,
    dropSocket,
    getState: () => ({ casting, hasSession: !!session, sessionId }),
  };
}
