// Control sender — the web room's half of the input plane. A ported subset of
// birdai-web's cymcast sender (core/cymcast-sender.js) without media: connect
// with a grant, create the two DataChannels, offer, trickle ICE, resume after a
// signaling blip, and climb a small recovery ladder (ICE restart, then a
// relay-only rebuild) before giving up so the caller can fall back to the socket.
//
// Every relayed message carries sessionId + sessionToken or cymcast drops it.

import { CHANNEL_LABEL, CONTROL_MESSAGE, encodeControlMessage } from '../../shared/protocol/control-messages';

export const BASE_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }),
]);
export const OPEN_TIMEOUT_MS = 5000;
export const RECONNECT_INITIAL_MS = 1000;
export const RECONNECT_MAX_MS = 15000;
export const STATS_INTERVAL_MS = 1000;
const MAX_RUNG = 2; // 1: ICE restart, 2: relay-only rebuild

/**
 * Builds the WebSocket URL of the cymcast signaling server.
 * @param {string} baseUrl - http(s) base URL
 * @returns {string} the ws(s) URL
 * @throws {Error} when the URL is not http(s)
 */
export function buildSignalingUrl(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) throw new Error(`cymcast server URL must be http(s), got: "${baseUrl}"`);
  return `${trimmed.replace(/^http/i, 'ws')}/ws`;
}

/**
 * Extracts the selected candidate pair type and RTT from an RTCStatsReport.
 * @param {RTCStatsReport|Map} report - the stats report
 * @returns {{pairType: string, rttMs: number|null}} 'host' | 'srflx' | 'prflx' | 'relay' | ''
 */
export function readSelectedPair(report) {
  let pair = null;
  const byId = new Map();
  report.forEach((r) => byId.set(r.id, r));
  report.forEach((r) => {
    if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = r;
  });
  if (!pair) return { pairType: '', rttMs: null };
  const local = byId.get(pair.localCandidateId);
  const remote = byId.get(pair.remoteCandidateId);
  const localType = (local && local.candidateType) || '';
  const remoteType = (remote && remote.candidateType) || '';
  const pairType = localType === 'relay' || remoteType === 'relay' ? 'relay' : localType || remoteType;
  const rttMs = typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null;
  return { pairType, rttMs };
}

/**
 * Creates a control sender.
 * @param {object} options - configuration
 * @param {string} options.cymcastUrl - cymcast base URL
 * @param {function(): Promise<string>} options.getGrant - mints the cast grant from bird-ai-server
 * @param {boolean} [options.forceRelay] - pin iceTransportPolicy to 'relay' (TURN test)
 * @param {function} [options.webSocketFactory] - WebSocket constructor (injectable)
 * @param {function(object): RTCPeerConnection} [options.peerConnectionFactory] - injectable
 * @param {function} [options.setTimeout] - injectable timer
 * @param {function} [options.clearTimeout] - injectable timer clear
 * @param {function} [options.setInterval] - injectable interval
 * @param {function} [options.clearInterval] - injectable interval clear
 * @param {object} [options.callbacks] - onStatus(text), onPhase(phase), onChannels({pointerChannel, controlChannel}), onPair({pairType, rttMs}), onClosed(reason), onError(code, message), onControlMessage(text)
 * @returns {object} sender API: start(), stop(), sendControl(message), getState()
 */
export function createControlSender({
  cymcastUrl,
  getGrant,
  forceRelay = false,
  webSocketFactory,
  peerConnectionFactory,
  setTimeout: setTimeoutImpl,
  clearTimeout: clearTimeoutImpl,
  setInterval: setIntervalImpl,
  clearInterval: clearIntervalImpl,
  callbacks,
}) {
  const noop = () => {};
  const cb = {
    onStatus: noop,
    onPhase: noop,
    onChannels: noop,
    onPair: noop,
    onClosed: noop,
    onError: noop,
    onControlMessage: noop,
    ...(callbacks || {}),
  };
  const WebSocketImpl = webSocketFactory || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  const createPc = peerConnectionFactory || ((cfg) => new RTCPeerConnection(cfg)); // eslint-disable-line no-undef
  const later = setTimeoutImpl || ((fn, ms) => setTimeout(fn, ms));
  const cancel = clearTimeoutImpl || ((id) => clearTimeout(id));
  const every = setIntervalImpl || ((fn, ms) => setInterval(fn, ms));
  const stopEvery = clearIntervalImpl || ((id) => clearInterval(id));
  const wsUrl = buildSignalingUrl(cymcastUrl);

  let ws = null;
  let pc = null;
  let pointerChannel = null;
  let controlChannel = null;
  let sessionId = '';
  let sessionToken = '';
  let iceServers = [...BASE_ICE_SERVERS];
  let pendingRemoteCandidates = [];
  let phase = 'idle'; // idle | signaling | connecting | ready | recovering | closed
  let rung = 0;
  let openTimer = null;
  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_INITIAL_MS;
  let statsTimer = null;
  let stopped = false;

  function setPhase(next, status) {
    phase = next;
    cb.onPhase(next);
    if (status) cb.onStatus(status);
  }

  function send(obj) {
    const OPEN = WebSocketImpl && typeof WebSocketImpl.OPEN === 'number' ? WebSocketImpl.OPEN : 1;
    if (ws && ws.readyState === OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function sendSession(obj) {
    if (!sessionId || !sessionToken) return false;
    return send({ ...obj, sessionId, sessionToken });
  }

  // ---- deadline: one bounded wait for "channels open", re-armed per attempt ----

  function armOpenDeadline() {
    cancel(openTimer);
    openTimer = later(() => {
      openTimer = null;
      if (phase === 'ready' || phase === 'closed') return;
      // A recovery rung that did not reconnect in time escalates to the next rung.
      if (phase === 'recovering') recover();
      else close('open-timeout');
    }, OPEN_TIMEOUT_MS);
  }

  // ---- signaling ----

  async function openSignaling({ resume = false } = {}) {
    if (stopped) return;
    cb.onStatus(resume ? 'signaling reconnecting' : 'signaling connecting');
    let socket;
    try {
      socket = new WebSocketImpl(wsUrl);
    } catch (_) {
      scheduleReconnect();
      return;
    }
    ws = socket;
    socket.onopen = () => {
      reconnectDelay = RECONNECT_INITIAL_MS;
      if (resume) {
        send({ type: 'resume', sessionId, sessionToken });
        return;
      }
      void sendConnect();
    };
    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      dispatch(message);
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (stopped || phase === 'closed') return;
      if (!sessionId) {
        close('signaling-lost');
        return;
      }
      // Session alive: ride it out, the DataChannel keeps flowing; resume on reopen.
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

  async function sendConnect() {
    let grant;
    try {
      grant = await getGrant();
    } catch (error) {
      cb.onError('grant-failed', String((error && error.message) || error));
      close('grant-failed');
      return;
    }
    if (stopped) return;
    send({ type: 'connect', token: grant });
    setPhase('signaling', 'joining panel');
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    reconnectTimer = later(() => {
      reconnectTimer = null;
      void openSignaling({ resume: true });
    }, delay);
  }

  function dispatch(message) {
    switch (message.type) {
      case 'peer':
        if (message.peer !== 'panel') return;
        sessionId = message.sessionId || '';
        sessionToken = message.sessionToken || '';
        iceServers = [...BASE_ICE_SERVERS, ...(Array.isArray(message.iceServers) ? message.iceServers : [])];
        startPeer({ policy: forceRelay ? 'relay' : 'all' });
        break;
      case 'answer':
        if (typeof message.sdp === 'string') void applyAnswer(message.sdp);
        break;
      case 'ice':
        if (message.candidate && typeof message.candidate === 'object') addRemoteCandidate(message.candidate);
        break;
      case 'restart':
        // The panel asks for a restart (ICE disconnected > 8 s on its side).
        void reoffer({ iceRestart: true });
        break;
      case 'bye':
        close(message.reason === 'preempted' ? 'preempted' : 'bye');
        break;
      case 'resumed':
        cb.onStatus('signaling resumed');
        break;
      case 'error':
        cb.onError(message.code || '', message.message || message.code || 'error');
        if (['grant-denied', 'room-not-found', 'room-busy', 'resume-rejected'].includes(message.code)) {
          close(message.code);
        }
        break;
      default:
        break;
    }
  }

  // ---- peer connection ----

  function closePc() {
    if (statsTimer) stopEvery(statsTimer);
    statsTimer = null;
    if (pc) {
      try {
        pc.close();
      } catch (_) {
        /* noop */
      }
    }
    pc = null;
    pointerChannel = null;
    controlChannel = null;
    pendingRemoteCandidates = [];
  }

  function startPeer({ policy }) {
    closePc();
    pc = createPc({ iceServers, iceTransportPolicy: policy });
    pendingRemoteCandidates = [];

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const c = event.candidate;
      sendSession({
        type: 'ice',
        candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex },
      });
    };
    pc.onconnectionstatechange = () => {
      const state = pc && pc.connectionState;
      if (state === 'connected') {
        rung = 0;
        startStats();
      } else if (state === 'failed') {
        recover();
      }
    };

    pointerChannel = pc.createDataChannel(CHANNEL_LABEL.POINTER, { ordered: false, maxRetransmits: 0 });
    pointerChannel.binaryType = 'arraybuffer';
    controlChannel = pc.createDataChannel(CHANNEL_LABEL.CONTROL);
    controlChannel.onmessage = (event) => cb.onControlMessage(event.data);
    pointerChannel.onopen = onChannelOpen;
    controlChannel.onopen = onChannelOpen;

    if (phase !== 'recovering') setPhase('connecting', 'connecting');
    armOpenDeadline();
    void reoffer({ iceRestart: false });
  }

  function onChannelOpen() {
    if (!pointerChannel || !controlChannel) return;
    if (pointerChannel.readyState !== 'open' || controlChannel.readyState !== 'open') return;
    cancel(openTimer);
    openTimer = null;
    setPhase('ready', 'ready');
    sendControl({ t: CONTROL_MESSAGE.HELLO, role: 'controller' });
    cb.onChannels({ pointerChannel, controlChannel });
  }

  async function reoffer({ iceRestart }) {
    if (!pc) return;
    const connection = pc;
    try {
      const offer = await connection.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (connection !== pc) return;
      await connection.setLocalDescription(offer);
      if (connection !== pc) return;
      sendSession({ type: 'offer', sdp: connection.localDescription.sdp });
    } catch (error) {
      cb.onError('offer-failed', String((error && error.message) || error));
    }
  }

  async function applyAnswer(sdp) {
    if (!pc) return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
      for (const candidate of pendingRemoteCandidates.splice(0)) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
    } catch (error) {
      cb.onError('answer-failed', String((error && error.message) || error));
    }
  }

  function addRemoteCandidate(candidate) {
    const normalized = {
      candidate: candidate.candidate || '',
      sdpMid: candidate.sdpMid != null ? candidate.sdpMid : '0',
      sdpMLineIndex: candidate.sdpMLineIndex != null ? candidate.sdpMLineIndex : 0,
    };
    if (!pc || !pc.remoteDescription) {
      pendingRemoteCandidates.push(normalized);
      return;
    }
    pc.addIceCandidate(normalized).catch(() => {});
  }

  function recover() {
    if (phase === 'closed' || stopped) return;
    rung += 1;
    if (rung > MAX_RUNG) {
      close('failed');
      return;
    }
    setPhase('recovering', `recovering connection (step ${rung}/${MAX_RUNG})`);
    if (rung === 1) {
      armOpenDeadline();
      void reoffer({ iceRestart: true });
    } else {
      startPeer({ policy: 'relay' });
    }
  }

  function startStats() {
    if (statsTimer || !pc || typeof pc.getStats !== 'function') return;
    const sample = async () => {
      if (!pc) return;
      const report = await pc.getStats().catch(() => null);
      if (report) cb.onPair(readSelectedPair(report));
    };
    void sample();
    statsTimer = every(sample, STATS_INTERVAL_MS);
  }

  // ---- lifecycle ----

  function sendControl(message) {
    if (!controlChannel || controlChannel.readyState !== 'open') return false;
    controlChannel.send(encodeControlMessage(message));
    return true;
  }

  function close(reason) {
    if (phase === 'closed') return;
    cancel(openTimer);
    cancel(reconnectTimer);
    openTimer = null;
    reconnectTimer = null;
    closePc();
    if (ws) {
      try {
        ws.close();
      } catch (_) {
        /* noop */
      }
      ws = null;
    }
    sessionId = '';
    sessionToken = '';
    setPhase('closed', `closed: ${reason}`);
    cb.onClosed(reason);
  }

  return {
    start() {
      stopped = false;
      // The deadline covers signaling and the grant too, not only ICE.
      armOpenDeadline();
      void openSignaling();
    },
    /**
     * User-initiated stop: sends bye (the only path that ever does) and closes.
     * @returns {void}
     */
    stop() {
      stopped = true;
      sendSession({ type: 'bye' });
      close('stopped');
    },
    sendControl,
    getState: () => ({ phase, rung, sessionId: sessionId ? 'set' : '', hasPc: !!pc }),
  };
}
