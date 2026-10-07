import React, { useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

/**
 * Converts a KeyboardEvent to the pipeline's key payload.
 * @param {KeyboardEvent} event - the DOM event
 * @param {boolean} down - pressed or released
 * @returns {object} the key payload
 */
function keyPayload(event, down) {
  return {
    key: event.key,
    code: event.code,
    down,
    mods: { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey },
  };
}

/**
 * Full-page touchpad: Pointer Events for mouse and touch (relative deltas, one
 * flush per frame via the pipeline), wheel, two-finger pan, physical keys with
 * key-up and repeat filtering, on-screen Left/Right buttons. `touch-action:
 * none` keeps the browser from panning or zooming mid-gesture.
 * @param {object} props - component props
 * @param {function(): object|null} props.getPipeline - returns the live input pipeline
 * @param {function(): void} props.onClose - closes the session
 * @param {string} props.statusLine - status text shown in the header
 * @param {function(): void} [props.onToggleScript] - starts or stops the gesture script
 * @param {boolean} [props.scriptRunning] - whether the gesture script is running
 * @returns {JSX.Element} the dialog
 */
export const RemoteDialog = ({ getPipeline, onClose, statusLine, onToggleScript, scriptRunning = false }) => {
  const padRef = useRef(null);
  const pointers = useRef(new Map()); // pointerId -> {x, y}

  const withPipeline = useCallback(
    (fn) => {
      const pipeline = getPipeline();
      if (pipeline) fn(pipeline);
    },
    [getPipeline],
  );

  const onPointerDown = (event) => {
    event.preventDefault();
    padRef.current.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType === 'mouse') withPipeline((p) => p.button(event.button, true));
  };

  const onPointerMove = (event) => {
    const last = pointers.current.get(event.pointerId);
    const isTouch = event.pointerType === 'touch';
    if (!last && isTouch) return;
    const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    let dx = 0;
    let dy = 0;
    let prev = last || { x: event.clientX, y: event.clientY };
    samples.forEach((sample) => {
      dx += sample.clientX - prev.x;
      dy += sample.clientY - prev.y;
      prev = { x: sample.clientX, y: sample.clientY };
    });
    if (last) pointers.current.set(event.pointerId, prev);
    if (isTouch && pointers.current.size >= 2) {
      withPipeline((p) => p.scroll(dx, dy));
      return;
    }
    if (dx || dy) withPipeline((p) => p.move(dx, dy));
  };

  const onPointerUp = (event) => {
    pointers.current.delete(event.pointerId);
    if (event.pointerType === 'mouse') withPipeline((p) => p.button(event.button, false));
  };

  const onWheel = (event) => {
    withPipeline((p) => p.scroll(event.deltaX, event.deltaY));
  };

  const onKeyDown = (event) => {
    if (event.repeat) return;
    event.preventDefault();
    withPipeline((p) => p.key(keyPayload(event, true)));
  };

  const onKeyUp = (event) => {
    event.preventDefault();
    withPipeline((p) => p.key(keyPayload(event, false)));
  };

  // Never leave a button held: blur, hide or leaving the pad releases everything.
  useEffect(() => {
    const release = () => withPipeline((p) => p.releaseAll());
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
    };
  }, [withPipeline]);

  useEffect(() => {
    if (padRef.current) padRef.current.focus();
  }, []);

  return (
    <div className="remote" data-testid="remote-dialog">
      <div className="remote-header">
        <span>Room Controller Mode</span>
        <span className="remote-status" data-testid="remote-status">
          {statusLine}
        </span>
        {onToggleScript ? (
          <button type="button" onClick={onToggleScript} data-testid="remote-script">
            {scriptRunning ? 'Stop gesture script' : 'Run 60 s gesture script'}
          </button>
        ) : null}
        <button type="button" onClick={onClose} data-testid="remote-close">
          Close
        </button>
      </div>
      <div
        ref={padRef}
        className="remote-pad"
        tabIndex={0}
        data-testid="remote-pad"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="remote-hint">Move here. Click, scroll and type as on a trackpad.</div>
      </div>
      <div className="remote-buttons">
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            withPipeline((p) => p.button(0, true));
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            withPipeline((p) => p.button(0, false));
          }}
          onContextMenu={(e) => e.preventDefault()}
          data-testid="remote-left"
        >
          Left (hold to drag)
        </button>
        <button type="button" onClick={() => withPipeline((p) => p.click(2))} data-testid="remote-right">
          Right click
        </button>
      </div>
    </div>
  );
};

RemoteDialog.propTypes = {
  getPipeline: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  statusLine: PropTypes.string,
  onToggleScript: PropTypes.func,
  scriptRunning: PropTypes.bool,
};
