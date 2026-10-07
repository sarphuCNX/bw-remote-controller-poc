// Input pipeline — the corrected version of birdai-web's remote-control
// capture (Target doc item AW2). Pure logic, no DOM: the React layer feeds it
// DOM-derived values and it talks to a sink.
//
// Rules:
//  - continuous input (pointer deltas, wheel) is accumulated and flushed at
//    most once per animation frame as ONE pointer frame (latest wins);
//  - discrete input (buttons, clicks, keys) is sequenced and sent immediately,
//    in order, through the reliable path;
//  - nothing is sent while the sink is disconnected (no buffered replay).

import { BUTTON_LEFT, BUTTON_MIDDLE, BUTTON_RIGHT } from '../../shared/protocol/pointer-frame';
import { CONTROL_MESSAGE } from '../../shared/protocol/control-messages';

const BUTTON_MASKS = Object.freeze({ 0: BUTTON_LEFT, 1: BUTTON_MIDDLE, 2: BUTTON_RIGHT });

/**
 * Creates an input pipeline bound to a sink.
 * @param {object} options - configuration
 * @param {{sendPointer: function(object): void, sendDiscrete: function(object): void, isConnected: function(): boolean}} options.sink - transport sink
 * @param {function(function): number} [options.requestFrame] - requestAnimationFrame (injectable)
 * @param {function(number): void} [options.cancelFrame] - cancelAnimationFrame (injectable)
 * @param {function(): number} [options.now] - clock in ms
 * @param {function(object): void} [options.onSent] - observer for sent events (metrics)
 * @returns {object} the pipeline API
 */
export function createInputPipeline({ sink, requestFrame, cancelFrame, now, onSent }) {
  const raf = requestFrame || ((fn) => requestAnimationFrame(fn));
  const caf = cancelFrame || ((id) => cancelAnimationFrame(id));
  const clock = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const notify = onSent || (() => {});

  let activeSink = sink;
  let pointerSeq = 0;
  let discreteSeq = 0;
  let buttons = 0;
  let pending = null; // accumulated frame for the next flush
  let frameHandle = null;

  function ensureFlushScheduled() {
    if (frameHandle !== null) return;
    frameHandle = raf(() => {
      frameHandle = null;
      flush();
    });
  }

  function flush() {
    if (!pending) return;
    const frame = pending;
    pending = null;
    if (!activeSink.isConnected()) return; // dropped, never replayed
    pointerSeq = (pointerSeq + 1) & 0xffff;
    const out = { ...frame, seq: pointerSeq, tsMs: clock(), buttons };
    activeSink.sendPointer(out);
    notify({ kind: 'pointer', ...out });
  }

  function accumulate(partial) {
    if (!pending) pending = { dx: 0, dy: 0, wheelX: 0, wheelY: 0, absolute: false };
    if (partial.absolute) {
      pending.absolute = true;
      pending.dx = partial.x;
      pending.dy = partial.y;
    } else {
      pending.dx += partial.dx || 0;
      pending.dy += partial.dy || 0;
    }
    pending.wheelX += partial.wheelX || 0;
    pending.wheelY += partial.wheelY || 0;
    ensureFlushScheduled();
  }

  function sendDiscrete(message) {
    if (!activeSink.isConnected()) return null;
    discreteSeq = (discreteSeq + 1) & 0xffff;
    const out = { ...message, seq: discreteSeq, ts: clock() };
    activeSink.sendDiscrete(out);
    notify({ kind: 'discrete', ...out });
    return out;
  }

  return {
    /**
     * Relative pointer motion (mouse or one-finger touch delta).
     * @param {number} dx - delta x in pad pixels
     * @param {number} dy - delta y in pad pixels
     * @returns {void}
     */
    move(dx, dy) {
      accumulate({ dx, dy });
    },
    /**
     * Absolute pointer position for a pad that maps 1:1 to the screen.
     * @param {number} x - 0..65535
     * @param {number} y - 0..65535
     * @returns {void}
     */
    moveAbsolute(x, y) {
      accumulate({ absolute: true, x, y });
    },
    /**
     * Scroll delta (wheel or two-finger pan), incremental.
     * @param {number} wheelX - delta x
     * @param {number} wheelY - delta y
     * @returns {void}
     */
    scroll(wheelX, wheelY) {
      accumulate({ wheelX, wheelY });
    },
    /**
     * Button state change (0 left, 1 middle, 2 right).
     * @param {number} button - DOM button index
     * @param {boolean} down - pressed or released
     * @returns {object|null} the sent message, or null when not connected
     */
    button(button, down) {
      const mask = BUTTON_MASKS[button] || 0;
      buttons = down ? buttons | mask : buttons & ~mask;
      return sendDiscrete({ t: CONTROL_MESSAGE.BUTTON, button, down });
    },
    /**
     * A full click (down and up) as one event, for on-screen buttons.
     * @param {number} button - DOM button index
     * @returns {object|null} the sent message, or null when not connected
     */
    click(button) {
      return sendDiscrete({ t: CONTROL_MESSAGE.CLICK, button });
    },
    /**
     * Key down or up. Auto-repeat must be filtered by the caller (`event.repeat`).
     * @param {object} key - key fields
     * @param {string} key.key - DOM key value
     * @param {string} key.code - DOM code value
     * @param {boolean} key.down - pressed or released
     * @param {object} [key.mods] - {ctrl, alt, shift, meta}
     * @returns {object|null} the sent message, or null when not connected
     */
    key({ key, code, down, mods }) {
      return sendDiscrete({ t: CONTROL_MESSAGE.KEY, key, code, down, mods: mods || {} });
    },
    /**
     * Releases every held button (blur, pointer leaves the pad, close), so a
     * drag can never stick on the panel.
     * @returns {void}
     */
    releaseAll() {
      [0, 1, 2].forEach((b) => {
        if (buttons & BUTTON_MASKS[b]) this.button(b, false);
      });
    },
    /**
     * Flushes any pending pointer frame immediately (used in tests and on close).
     * @returns {void}
     */
    flushNow() {
      if (frameHandle !== null) {
        caf(frameHandle);
        frameHandle = null;
      }
      flush();
    },
    /**
     * Swaps the transport sink (comparison mode).
     * @param {object} nextSink - the new sink
     * @returns {void}
     */
    setSink(nextSink) {
      activeSink = nextSink;
    },
    heldButtons: () => buttons,
    dispose() {
      if (frameHandle !== null) caf(frameHandle);
      frameHandle = null;
      pending = null;
    },
  };
}
