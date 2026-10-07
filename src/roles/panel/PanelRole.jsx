import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readConfig, saveConfig, isConfigReady } from '../../vendor/simulator/core/simulator-config';
import { getVersion } from '../../vendor/simulator/core/simulator-versions';
import { useDeviceSimulator } from '../../vendor/simulator/hooks/useDeviceSimulator';
import { ConfigPanel } from '../../vendor/simulator/components/config-panel';
import { PinDisplay } from '../../vendor/simulator/components/pin-display';
import { createControlReceiver } from './control-receiver';
import { applyV1Payload, extractV1Payload } from './v1-apply';
import { readSelectedPair } from '../web-room/control-sender';
import { CursorCanvas } from './CursorCanvas';

const SURFACE = Object.freeze({ width: 1920, height: 1080 });
const PAIR_SAMPLE_MS = 1000;

/**
 * Panel role: the vendored device simulator (register, Room ID, pairing PIN,
 * cymcast receiver) plus the POC control receiver. Input from either path
 * (DataChannels or the REMOTE_CONTROL socket events) drives one virtual cursor.
 * @returns {JSX.Element} the panel screen
 */
const PanelRole = () => {
  const [config, setConfig] = useState(() => ({ ...readConfig(), version: 'v3' }));
  const [cursor, setCursor] = useState({ x: SURFACE.width / 2, y: SURFACE.height / 2, buttons: 0 });
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [pair, setPair] = useState({ pairType: '', rttMs: null });
  const [applyDelay, setApplyDelay] = useState(0);
  const pcRef = useRef(null);
  const simRef = useRef(null);
  const pairedUserIdRef = useRef('');

  const appendEvent = useCallback((line) => {
    setEvents((prev) => [...prev.slice(-199), `${new Date().toISOString().slice(11, 23)} ${line}`]);
  }, []);

  const receiver = useMemo(
    () =>
      createControlReceiver({
        surface: SURFACE,
        callbacks: {
          onCursor: (c) => setCursor({ x: c.x, y: c.y, buttons: c.buttons }),
          onEvent: (e) => appendEvent(`dc ${e.t} ${e.key || e.button !== undefined ? e.key || `button ${e.button}` : ''} ${e.down === undefined ? '' : e.down ? 'down' : 'up'} seq ${e.seq}`),
          onStats: setStats,
        },
      }),
    [appendEvent],
  );

  useEffect(() => receiver.setApplyDelay(applyDelay), [receiver, applyDelay]);

  const onDataChannel = useCallback(
    (channel, pc) => {
      pcRef.current = pc;
      receiver.attachChannel(channel);
      appendEvent(`datachannel ${channel.label} attached`);
    },
    [appendEvent, receiver],
  );

  // Socket path: apply v1 payloads to the same cursor, ack via MEETING_COMMAND.
  const onRemoteControl = useCallback(
    (event) => {
      const payload = extractV1Payload(event);
      if (!payload) return;
      const recvTs = performance.now();
      const next = { ...cursorRef.current };
      const result = applyV1Payload(payload, next, SURFACE);
      cursorRef.current = next;
      if (result.kind === 'move' || result.kind === 'button') setCursor({ ...next });
      const reply = (message) =>
        simRef.current && simRef.current.sendMeetingCommand({ userId: pairedUserIdRef.current, ...message });
      if (result.kind === 'probe') {
        reply({ kind: 'probe-ack', id: result.event.id, ts: result.event.ts, panelTs: performance.now() });
        return;
      }
      if (result.kind !== 'ignored' && result.kind !== 'move' && result.kind !== 'wheel') {
        appendEvent(`socket ${payload.type}`);
      }
      if (payload.seq !== undefined) reply({ kind: 'ack', seq: payload.seq, recvTs, applyTs: performance.now() });
    },
    [appendEvent],
  );
  const cursorRef = useRef(cursor);

  const sim = useDeviceSimulator({ onDataChannel, onRemoteControl });
  simRef.current = sim;
  pairedUserIdRef.current = sim.pairedUserId || '';

  useEffect(() => saveConfig(config), [config]);

  // Sample the selected ICE pair on the panel side too.
  useEffect(() => {
    const timer = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc || typeof pc.getStats !== 'function') return;
      const report = await pc.getStats().catch(() => null);
      if (report) setPair(readSelectedPair(report));
    }, PAIR_SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);

  const live = sim.phase === 'online';
  const version = getVersion(sim.version);

  return (
    <div className="page" data-testid="panel-role">
      <header className="page-header">
        <div>
          <h1>Panel (device simulator)</h1>
          <div className="muted">Register, show the Room ID and PIN, receive remote control.</div>
        </div>
        {sim.paired ? (
          <span className="pill" data-testid="panel-paired">
            paired{sim.deviceName ? `: ${sim.deviceName}` : ''}
          </span>
        ) : null}
      </header>

      {!live ? (
        <ConfigPanel
          config={config}
          onChange={setConfig}
          onGoLive={() => sim.goLive(config)}
          canGoLive={isConfigReady(config)}
          connecting={sim.phase === 'connecting'}
        />
      ) : (
        <section className="card">
          <div className="muted">{version.label}</div>
          <div className="code-block">
            <div className="muted">Room ID, enter this in the web room</div>
            <div className="code-value" data-testid="panel-device-code">
              {sim.deviceCode || '-'}
            </div>
          </div>
          <PinDisplay label="Pairing PIN" value={sim.pairingPin} testId="panel-pairing-pin" />
          <div className="row muted">
            <span>device: {sim.birdStatus || 'connecting'}</span>
            <span>cymcast: {sim.panelStatus || 'connecting'}</span>
            <span data-testid="panel-pair-type">ICE pair: {pair.pairType || '-'}</span>
            <label>
              apply delay {applyDelay} ms
              <input type="range" min="0" max="30" value={applyDelay} onChange={(e) => setApplyDelay(Number(e.target.value))} />
            </label>
            <button type="button" onClick={sim.stop} data-testid="panel-stop">
              Stop device
            </button>
          </div>
          <CursorCanvas cursor={cursor} surface={SURFACE} />
          <div className="row muted" data-testid="panel-stats">
            {stats
              ? `pointer frames ${stats.pointerFrames} · lost ${stats.pointerLost} · discrete ${stats.discreteEvents}`
              : 'no input yet'}
          </div>
          <pre className="log" data-testid="panel-log">
            {events.slice(-12).join('\n')}
          </pre>
          {sim.error ? <div className="error">{sim.error}</div> : null}
        </section>
      )}
    </div>
  );
};

export default PanelRole;
