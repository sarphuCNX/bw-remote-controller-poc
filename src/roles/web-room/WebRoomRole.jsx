import React, { useEffect, useRef, useState } from 'react';
import config from '../../shared/config';
import { useAnonymousSession } from './use-anonymous-session';
import { usePairing, PAIRING_STEP } from './use-pairing';
import { useControlSession, PATH } from './use-control-session';
import { RemoteDialog } from './RemoteDialog';
import { MetricsPanel } from './MetricsPanel';
import { buildGestureScript, runGestureScript } from './gesture-script';

/**
 * Web room role: anonymous session, pairing by Room ID and PIN, then remote
 * control over the DataChannel or the socket path, with live metrics.
 * @returns {JSX.Element} the web room screen
 */
const WebRoomRole = () => {
  const session = useAnonymousSession({ birdUrl: config.BIRDAI_SERVER_URL });
  const pairing = usePairing({
    api: session.api,
    token: session.token,
    subscribe: session.subscribe,
    socketStatus: session.status,
  });
  const control = useControlSession({
    socket: session.socket,
    subscribe: session.subscribe,
    api: session.api,
    token: session.token,
    cymcastUrl: config.CYMCAST_SERVER_URL,
  });
  const [scriptRunning, setScriptRunning] = useState(false);
  const scriptRef = useRef(null);

  const runScript = () => {
    const pipeline = control.pipeline();
    if (!pipeline) return;
    setScriptRunning(true);
    scriptRef.current = runGestureScript({
      steps: buildGestureScript(),
      pipeline,
      onDone: () => setScriptRunning(false),
    });
  };
  const stopScript = () => {
    if (scriptRef.current) scriptRef.current.cancel();
    scriptRef.current = null;
    setScriptRunning(false);
  };

  // Closing a session ends any running script, so the next session starts clean.
  useEffect(() => {
    if (!control.open && scriptRef.current) {
      scriptRef.current.cancel();
      scriptRef.current = null;
      setScriptRunning(false);
    }
  }, [control.open]);

  return (
    <div className="page" data-testid="web-room-role">
      <header className="page-header">
        <div>
          <h1>Web room</h1>
          <div className="muted">
            server {config.BIRDAI_SERVER_URL} · cymcast {config.CYMCAST_SERVER_URL}
          </div>
        </div>
        <div className="muted" data-testid="session-status">
          session: {session.status}
          {session.userId ? ` · user ${session.userId.slice(0, 8)}` : ''}
          {session.error ? ` · ${session.error}` : ''}
        </div>
      </header>

      {!pairing.isPaired ? (
        <section className="card" data-testid="pairing-form">
          <h2>Pair with a panel</h2>
          {pairing.step === PAIRING_STEP.ROOM_ID ? (
            <div className="row">
              <input
                value={pairing.roomId}
                onChange={(e) => pairing.setRoomId(e.target.value)}
                placeholder="Room ID shown on the panel"
                data-testid="room-id-input"
              />
              <button type="button" onClick={pairing.requestPin} disabled={pairing.busy || !session.token} data-testid="request-pin">
                Request PIN
              </button>
            </div>
          ) : (
            <div className="row">
              <span className="muted">Room {pairing.roomId}</span>
              <input
                value={pairing.pin}
                onChange={(e) => pairing.setPin(e.target.value)}
                placeholder="PIN shown on the panel"
                inputMode="numeric"
                data-testid="pin-input"
              />
              <button type="button" onClick={pairing.pair} disabled={pairing.busy} data-testid="pair">
                Pair
              </button>
            </div>
          )}
          <div className="muted" data-testid="pairing-message">
            {pairing.message}
          </div>
        </section>
      ) : (
        <section className="card" data-testid="paired-panel">
          <h2>
            Paired with {pairing.deviceName || pairing.roomId} <span className="pill">paired</span>
          </h2>
          <div className="row">
            <label>
              Input path
              <select
                value={control.preferredPath}
                onChange={(e) => control.switchPath(e.target.value)}
                data-testid="path-select"
              >
                <option value={PATH.DATACHANNEL}>DataChannel (cymcast + TURN)</option>
                <option value={PATH.SOCKET}>Socket (bird-ai-server, today)</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={control.forceRelay}
                onChange={(e) => control.setForceRelay(e.target.checked)}
                disabled={control.open}
                data-testid="force-relay"
              />
              force TURN relay
            </label>
            {!control.open ? (
              <button type="button" onClick={control.start} data-testid="room-control">
                Room Control
              </button>
            ) : (
              <button type="button" onClick={control.stop} data-testid="stop-control">
                Stop
              </button>
            )}
            <button type="button" onClick={pairing.unpair} disabled={pairing.busy || control.open} data-testid="unpair">
              Unpair
            </button>
          </div>
          <div className="row">
            <button type="button" onClick={scriptRunning ? stopScript : runScript} disabled={!control.open} data-testid="gesture-script">
              {scriptRunning ? 'Stop gesture script' : 'Run 60 s gesture script'}
            </button>
            <span className="muted" data-testid="control-status">
              {control.open
                ? `${control.activePath || 'starting'} · ${control.phase} · ${control.status}`
                : control.endedReason
                  ? `session ended: ${control.endedReason}`
                  : 'idle'}
            </span>
          </div>
          <MetricsPanel metrics={control.metrics} log={control.log} />
        </section>
      )}

      {control.open ? (
        <RemoteDialog
          getPipeline={control.pipeline}
          onClose={control.stop}
          onToggleScript={scriptRunning ? stopScript : runScript}
          scriptRunning={scriptRunning}
          statusLine={`${control.activePath || 'starting'} · ${control.pair.pairType || '-'} · ${control.status}${
            control.metrics ? ` · RTT p50 ${Number.isFinite(control.metrics.probeRtt.p50) ? control.metrics.probeRtt.p50.toFixed(1) : '-'} ms` : ''
          }`}
        />
      ) : null}
    </div>
  );
};

export default WebRoomRole;
