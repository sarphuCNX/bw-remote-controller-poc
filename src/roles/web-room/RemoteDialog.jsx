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
  const pointers = useRef(new Map()); // pressed pointers: pointerId -> {x, y}
  const hover = useRef(null); // last mouse position while no button is held

  const withPipeline = useCallback(
    (fn) => {
      const pipeline = getPipeline();
      if (pipeline) fn(pipeline);
    },
    [getPipeline],
  );

  const onPointerDown = (event) => {
    event.preventDefault();
    if (padRef.current && typeof padRef.current.setPointerCapture === 'function') {
      padRef.current.setPointerCapture(event.pointerId);
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    hover.current = null;
    if (event.pointerType === 'mouse') withPipeline((p) => p.button(event.button, true));
  };

  const onPointerMove = (event) => {
    const isTouch = event.pointerType === 'touch';
    const pressed = pointers.current.get(event.pointerId);
    let last = pressed;
    if (!last) {
      if (isTouch) return; // a touch that did not start on the pad
      // Plain mouse motion: the first sample only seeds the reference point.
      if (!hover.current) {
        hover.current = { x: event.clientX, y: event.clientY };
        return;
      }
      last = hover.current;
    }
    // Coalesced samples live on the native event; React's synthetic event does not expose them.
    const native = event.nativeEvent;
    const coalesced = native && typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : null;
    const samples = coalesced && coalesced.length ? coalesced : [event];
    let dx = 0;
    let dy = 0;
    let prev = last;
    samples.forEach((sample) => {
      dx += sample.clientX - prev.x;
      dy += sample.clientY - prev.y;
      prev = { x: sample.clientX, y: sample.clientY };
    });
    if (pressed) pointers.current.set(event.pointerId, prev);
    else hover.current = prev;
    if (isTouch && pointers.current.size >= 2) {
      withPipeline((p) => p.scroll(dx, dy));
      return;
    }
    if (dx || dy) withPipeline((p) => p.move(dx, dy));
  };

  const onPointerUp = (event) => {
    const lastPressed = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (event.pointerType === 'mouse') {
      hover.current = lastPressed || { x: event.clientX, y: event.clientY };
      if (event.button >= 0) withPipeline((p) => p.button(event.button, false));
    }
  };

  // A mouse that leaves the pad (or is cancelled) must never leave a button
  // held: there is only one mouse pointer, so whatever it holds (pressed on the
  // pad, or on the on-screen Left button) is released. Touch pointers fire
  // pointerleave after every lift, and a button may be held by another finger
  // on the on-screen button, so touch lifts only forget their own pointer.
  const onPointerGone = (event) => {
    const wasPressed = pointers.current.has(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (event.pointerType !== 'mouse') return;
    hover.current = null;
    withPipeline((p) => {
      if (wasPressed || (typeof p.heldButtons === 'function' && p.heldButtons())) p.releaseAll();
    });
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
        onPointerCancel={onPointerGone}
        onPointerLeave={onPointerGone}
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
