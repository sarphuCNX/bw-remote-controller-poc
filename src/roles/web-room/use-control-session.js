// Control session — ties the sender, the sinks, the input pipeline, the probe
// and the metrics together. REMOTE_START / REMOTE_STOP always go over the
// socket (production bookkeeping); the input plane is the DataChannel when it
// opens, or the socket path (comparison mode, or fallback after a timeout).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createControlSender } from './control-sender';
import { createDataChannelSink, createSocketSink, SOCKET_CHANNEL, V1_TYPES } from './sinks';
import { createInputPipeline } from './input-pipeline';
import { createLatencyProbe } from '../../shared/metrics/latency-probe';
import { createSampleRing, summarize } from '../../shared/metrics/stats';
import { CONTROL_MESSAGE, decodeControlMessage } from '../../shared/protocol/control-messages';

export const PATH = Object.freeze({ DATACHANNEL: 'datachannel', SOCKET: 'socket' });
const FALLBACK_REASONS = new Set(['open-timeout', 'failed', 'grant-failed', 'room-not-found', 'room-busy', 'grant-denied']);

/**
 * Manages a remote-control session.
 * @param {object} options - configuration
 * @param {object|null} options.socket - the `/user-events` socket
 * @param {function} options.subscribe - session event subscription
 * @param {object} options.api - bird API client
 * @param {string} options.token - caller JWT
 * @param {string} options.cymcastUrl - cymcast base URL
 * @returns {object} session state and actions
 */
export function useControlSession({ socket, subscribe, api, token, cymcastUrl }) {
  const [preferredPath, setPreferredPath] = useState(PATH.DATACHANNEL);
  const [forceRelay, setForceRelay] = useState(false);
  const [open, setOpen] = useState(false);
  const [activePath, setActivePath] = useState('');
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('');
  const [pair, setPair] = useState({ pairType: '', rttMs: null });
  const [metrics, setMetrics] = useState(null);
  const [log, setLog] = useState([]);

  const senderRef = useRef(null);
  const pipelineRef = useRef(null);
  const probeRef = useRef(null);
  const ackRttRef = useRef(createSampleRing(300));
  const sentRef = useRef(new Map()); // seq -> ts for discrete acks
  const eventsPerSecondRef = useRef({ count: 0, since: 0 });
  const channelsRef = useRef(null);

  const appendLog = useCallback((line) => {
    setLog((prev) => [...prev.slice(-199), `${new Date().toISOString().slice(11, 23)} ${line}`]);
  }, []);

  const socketSink = useMemo(
    () =>
      createSocketSink({
        emit: (channel, payload) => socket && socket.emit(channel, payload),
        isConnected: () => !!socket && socket.connected,
      }),
    [socket],
  );

  // Ack and probe replies arriving over either path feed the same metrics.
  const onControlReply = useCallback((message) => {
    if (!message) return;
    if (probeRef.current && probeRef.current.onMessage(message)) return;
    if (message.t === CONTROL_MESSAGE.ACK) {
      const sentAt = sentRef.current.get(message.seq);
      if (sentAt !== undefined) {
        ackRttRef.current.push(performance.now() - sentAt);
        sentRef.current.delete(message.seq);
      }
    }
  }, []);

  // Socket path replies: the panel relays acks/probe-acks through MEETING_COMMAND.
  useEffect(() => {
    return subscribe(({ event, payload }) => {
      if (event !== 'message' || !payload) return;
      if (payload.type === 'MEETING_COMMAND' && payload.kind) {
        if (payload.kind === 'probe-ack') onControlReply({ t: CONTROL_MESSAGE.PROBE_ACK, id: payload.id, ts: payload.ts, panelTs: payload.panelTs });
        if (payload.kind === 'ack') onControlReply({ t: CONTROL_MESSAGE.ACK, seq: payload.seq, recvTs: payload.recvTs, applyTs: payload.applyTs });
      }
      if (payload.type === 'OPEN_REMOTE_CONTROLLER') appendLog('socket: OPEN_REMOTE_CONTROLLER');
      if (event === 'exception') appendLog(`socket exception: ${JSON.stringify(payload)}`);
    });
  }, [subscribe, onControlReply, appendLog]);

  const ensurePipeline = useCallback((sink) => {
    if (!pipelineRef.current) {
      pipelineRef.current = createInputPipeline({
        sink,
        onSent: (sent) => {
          const counter = eventsPerSecondRef.current;
          counter.count += 1;
          if (sent.kind === 'discrete') sentRef.current.set(sent.seq, performance.now());
        },
      });
    } else {
      pipelineRef.current.setSink(sink);
    }
    return pipelineRef.current;
  }, []);

  const startProbe = useCallback((send) => {
    if (probeRef.current) probeRef.current.stop();
    probeRef.current = createLatencyProbe({ send });
    probeRef.current.start();
  }, []);

  const activateSocketPath = useCallback(
    (reason) => {
      setActivePath(PATH.SOCKET);
      ensurePipeline(socketSink);
      startProbe((probe) => {
        if (!socket || !socket.connected) return false;
        socket.emit(SOCKET_CHANNEL, { type: 'PROBE', id: probe.id, ts: probe.ts });
        return true;
      });
      appendLog(`input path: socket (${reason})`);
    },
    [appendLog, ensurePipeline, socket, socketSink, startProbe],
  );

  const startDataChannel = useCallback(() => {
    const sender = createControlSender({
      cymcastUrl,
      forceRelay,
      getGrant: () => api.castGrant(token),
      callbacks: {
        onStatus: setStatus,
        onPhase: setPhase,
        onPair: setPair,
        onError: (code, message) => appendLog(`sender error ${code}: ${message}`),
        onControlMessage: (text) => onControlReply(decodeControlMessage(text)),
        onChannels: (channels) => {
          channelsRef.current = channels;
          setActivePath(PATH.DATACHANNEL);
          ensurePipeline(createDataChannelSink(channels));
          startProbe((probe) => sender.sendControl(probe));
          appendLog('input path: datachannel (open)');
        },
        onClosed: (reason) => {
          appendLog(`datachannel closed: ${reason}`);
          channelsRef.current = null;
          if (FALLBACK_REASONS.has(reason)) activateSocketPath(`fallback after ${reason}`);
        },
      },
    });
    senderRef.current = sender;
    sender.start();
  }, [api, appendLog, cymcastUrl, ensurePipeline, forceRelay, onControlReply, startProbe, token, activateSocketPath]);

  const start = useCallback(() => {
    if (!socket || !socket.connected) return appendLog('socket not connected');
    ackRttRef.current.clear();
    sentRef.current.clear();
    eventsPerSecondRef.current = { count: 0, since: performance.now() };
    setStatus('');
    setPair({ pairType: '', rttMs: null });
    setMetrics(null);
    socket.emit(SOCKET_CHANNEL, { type: V1_TYPES.REMOTE_START });
    setOpen(true);
    if (preferredPath === PATH.DATACHANNEL) startDataChannel();
    else activateSocketPath('selected');
  }, [appendLog, preferredPath, socket, startDataChannel, activateSocketPath]);

  const stop = useCallback(() => {
    if (pipelineRef.current) {
      pipelineRef.current.releaseAll();
      pipelineRef.current.dispose();
      pipelineRef.current = null;
    }
    if (probeRef.current) probeRef.current.stop();
    probeRef.current = null;
    if (senderRef.current) senderRef.current.stop();
    senderRef.current = null;
    channelsRef.current = null;
    if (socket && socket.connected) socket.emit(SOCKET_CHANNEL, { type: V1_TYPES.REMOTE_STOP });
    setOpen(false);
    setActivePath('');
    setPhase('idle');
  }, [socket]);

  // Switch path while open (comparison mode).
  const switchPath = useCallback(
    (next) => {
      setPreferredPath(next);
      if (!open) return;
      if (next === PATH.SOCKET) {
        if (senderRef.current) senderRef.current.stop();
        senderRef.current = null;
        activateSocketPath('switched');
      } else if (!senderRef.current) {
        startDataChannel();
      }
    },
    [open, startDataChannel, activateSocketPath],
  );

  // Metrics snapshot every second.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => {
      const probe = probeRef.current;
      const rtts = probe ? probe.rttSamples() : [];
      const acks = ackRttRef.current.values();
      const counter = eventsPerSecondRef.current;
      const elapsed = Math.max(1, (performance.now() - counter.since) / 1000);
      setMetrics({
        path: activePath,
        pairType: pair.pairType,
        iceRttMs: pair.rttMs,
        probeRtt: summarize(rtts),
        ackRtt: summarize(acks),
        clockOffsetMs: probe ? probe.clockOffsetMs() : null,
        eventsPerSecond: counter.count / elapsed,
        forceRelay,
        at: new Date().toISOString(),
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [open, activePath, pair, forceRelay]);

  useEffect(() => () => stop(), [stop]);

  return {
    open,
    phase,
    status,
    activePath,
    preferredPath,
    switchPath,
    forceRelay,
    setForceRelay,
    pair,
    metrics,
    log,
    start,
    stop,
    pipeline: () => pipelineRef.current,
  };
}
