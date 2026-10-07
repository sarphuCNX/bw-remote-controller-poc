import React, { useEffect, useRef, useState } from 'react';
import { readConfig, saveConfig, isConfigReady } from '../core/simulator-config';
import { getVersion } from '../core/simulator-versions';
import { useDeviceSimulator } from '../hooks/useDeviceSimulator';
import { ConfigPanel } from './config-panel';
import { PinDisplay } from './pin-display';
import classes from './simulator.module.css';

/**
 * Device simulator page — a browser stand-in for a physical Bird panel. A
 * developer opens it in a new tab, sets the server URLs + panel secret, clicks
 * "Go live", then pairs the dashboard to the shown Room ID (copying the PINs it
 * displays) and watches the screen share render here.
 * @returns {JSX.Element} the simulator page
 */
const DeviceSimulator = () => {
  const [config, setConfig] = useState(() => readConfig());
  const sim = useDeviceSimulator();
  const videoRef = useRef(null);
  const screenRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  // Track whether the cast screen area owns the fullscreen state, so the toggle
  // label stays correct even when the user exits via the Esc key.
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(
        !!document.fullscreenElement && document.fullscreenElement === screenRef.current,
      );
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  /**
   * Toggles fullscreen on the cast screen area. Enters fullscreen on the screen
   * element when nothing is fullscreen; exits otherwise. Rejections (e.g. the
   * request was not triggered by a user gesture) are swallowed.
   * @returns {void}
   */
  const toggleFullscreen = () => {
    const el = screenRef.current;
    if (!el) return;
    const request = document.fullscreenElement
      ? document.exitFullscreen && document.exitFullscreen()
      : el.requestFullscreen && el.requestFullscreen();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  };

  // Attach the incoming cast stream to the <video> element.
  useEffect(() => {
    const stream = sim.videoStreamRef.current;
    if (videoRef.current) {
      videoRef.current.srcObject = stream || null;
      if (stream) {
        const played = videoRef.current.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
      }
    }
  }, [sim.videoStreamRef, sim.casting, sim.phase]);

  const live = sim.phase === 'online';
  const connecting = sim.phase === 'connecting';
  const activeVersion = getVersion(sim.version);

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <div>
          <div className={classes.title}>Bird Device Simulator</div>
          <div className={classes.subtitle}>
            Pair the dashboard to this device, then cast a screen to it.
          </div>
        </div>
        {sim.paired ? (
          <span className={classes.pairedPill} data-testid="simulator-paired">
            Paired{sim.deviceName ? `: ${sim.deviceName}` : ''}
          </span>
        ) : null}
      </div>

      {!live ? (
        <ConfigPanel
          config={config}
          onChange={setConfig}
          onGoLive={() => sim.goLive(config)}
          canGoLive={isConfigReady(config)}
          connecting={connecting}
        />
      ) : (
        <div className={classes.panel}>
          <div className={classes.versionBanner} data-testid="simulator-active-version">
            <strong>{activeVersion.label}</strong> — {activeVersion.description}
          </div>

          <div className={classes.codeBlock}>
            <div className={classes.codeLabel}>Room ID — enter this in the dashboard</div>
            <div className={classes.codeValue} data-testid="simulator-device-code">
              {sim.deviceCode || '—'}
            </div>
            <div className={classes.codeCaption} data-testid="simulator-cymcast-code">
              {activeVersion.behavior.reportRoomCode
                ? `Cymcast room code (reported): ${sim.cymcastRoomCode || '—'}`
                : `Cymcast room code: ${sim.cymcastRoomCode || '—'} (not reported — cast is grant-authorized)`}
            </div>
          </div>

          <div className={classes.pinRow}>
            <PinDisplay label="Pairing PIN" value={sim.pairingPin} testId="simulator-pairing-pin" />
            {activeVersion.behavior.advertiseShowPin ? (
              <PinDisplay
                label="Cast PIN"
                value={sim.castPin ? sim.castPin.value : ''}
                expiresAt={sim.castPin ? sim.castPin.expiresAt : null}
                cast
                testId="simulator-cast-pin"
              />
            ) : null}
          </div>

          <div className={classes.screen} ref={screenRef} data-testid="simulator-screen">
            <video
              ref={videoRef}
              className={classes.video}
              autoPlay
              playsInline
              data-testid="simulator-video"
            />
            <button
              type="button"
              className={classes.fullscreenButton}
              onClick={toggleFullscreen}
              aria-pressed={isFullscreen}
              data-testid="simulator-fullscreen-toggle"
            >
              {isFullscreen ? '⛶ Exit fullscreen' : '⛶ Fullscreen'}
            </button>
            {!sim.casting ? (
              <div className={classes.screenIdle} data-testid="simulator-screen-idle">
                <div>Waiting for a screen share…</div>
                <div>{sim.panelStatus || 'ready to receive'}</div>
              </div>
            ) : null}
            {sim.casting && sim.stats ? (
              <div className={classes.statsOverlay} data-testid="simulator-stats">
                {sim.stats.res || '?'} · {Math.round(sim.stats.fps || 0)} fps ·{' '}
                {sim.stats.framesDecoded || 0} frames
              </div>
            ) : null}
          </div>

          <div className={classes.statusRow}>
            <span>Device: {sim.birdStatus || 'connecting'}</span>
            <span>Cast: {sim.panelStatus || 'connecting'}</span>
            <button
              type="button"
              className={classes.secondaryButton}
              onClick={sim.stop}
              data-testid="simulator-stop"
            >
              Stop device
            </button>
          </div>

          {sim.error ? (
            <div className={classes.errorText} data-testid="simulator-error">
              {sim.error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default DeviceSimulator;
