// Control receiver — the panel side of the input plane. Decodes pointer frames
// and control messages from the two DataChannels, applies them to a virtual
// cursor (what the Android injector would do), acks discrete events, answers
// probes, and detects pointer loss by sequence gaps.

import { countSeqGap, decodePointerFrame } from '../../shared/protocol/pointer-frame';
import {
  CONTROL_MESSAGE,
  buildAck,
  buildProbeAck,
  decodeControlMessage,
  encodeControlMessage,
} from '../../shared/protocol/control-messages';

const DEFAULT_SURFACE = Object.freeze({ width: 1920, height: 1080 });

/**
 * Creates a control receiver.
 * @param {object} options - configuration
 * @param {{width: number, height: number}} [options.surface] - virtual screen size
 * @param {function(): number} [options.now] - panel clock in ms
 * @param {number} [options.applyDelayMs] - simulated injection latency (0 = none)
 * @param {function(function, number): number} [options.setTimeout] - injectable timer
 * @param {object} [options.callbacks] - onCursor({x, y, buttons}), onEvent(message), onStats(stats), onHello(hello)
 * @returns {object} the receiver API
 */
export function createControlReceiver({ surface = DEFAULT_SURFACE, now, applyDelayMs = 0, setTimeout: setTimeoutImpl, callbacks } = {}) {
  const clock = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const schedule = setTimeoutImpl || ((fn, ms) => setTimeout(fn, ms));
  const noop = () => {};
  const cb = { onCursor: noop, onEvent: noop, onStats: noop, onHello: noop, ...(callbacks || {}) };

  const cursor = { x: surface.width / 2, y: surface.height / 2, buttons: 0 };
  const stats = { pointerFrames: 0, pointerLost: 0, discreteEvents: 0, lastSeq: -1 };
  let controlChannel = null;
  let delay = applyDelayMs;
  let currentSessionId = '';
  let hasSession = false;
  // Bumped whenever the control source goes away; delayed applies captured
  // under an older generation are dropped instead of landing on the new state.
  let generation = 0;

  /**
   * Releases every held button, as a real injector must when its controller
   * goes away: a drag must never outlive the channel that started it. Also
   * invalidates any apply still queued behind the simulated delay.
   * @returns {void}
   */
  function releaseHeldButtons() {
    generation += 1;
    if (!cursor.buttons) return;
    cursor.buttons = 0;
    cb.onCursor({ ...cursor });
  }

  const clamp = (v, max) => Math.max(0, Math.min(max, v));

  function sendControl(message) {
    if (!controlChannel || controlChannel.readyState !== 'open') return false;
    controlChannel.send(encodeControlMessage(message));
    return true;
  }

  function applyPointer(frame) {
    if (frame.absolute) {
      cursor.x = (frame.dx / 65535) * surface.width;
      cursor.y = (frame.dy / 65535) * surface.height;
    } else {
      cursor.x = clamp(cursor.x + frame.dx, surface.width);
      cursor.y = clamp(cursor.y + frame.dy, surface.height);
    }
    // Button state comes only from the reliable control channel: a late or
    // reordered pointer frame must never re-press a released button.
    cb.onCursor({ ...cursor, wheelX: frame.wheelX, wheelY: frame.wheelY, tsMs: frame.tsMs });
  }

  function withApplyDelay(fn) {
    if (delay <= 0) {
      fn();
      return;
    }
    const scheduledGeneration = generation;
    schedule(() => {
      if (scheduledGeneration === generation) fn();
    }, delay);
  }

  /**
   * Handles a pointer-channel payload.
   * @param {ArrayBuffer|Uint8Array} data - the frame bytes
   * @returns {void}
   */
  function onPointerData(data) {
    let frame;
    try {
      frame = decodePointerFrame(data);
    } catch (_) {
      return;
    }
    stats.pointerFrames += 1;
    stats.pointerLost += countSeqGap(stats.lastSeq, frame.seq);
    stats.lastSeq = frame.seq;
    withApplyDelay(() => applyPointer(frame));
    cb.onStats({ ...stats });
  }

  /**
   * Handles a control-channel payload.
   * @param {string} text - the JSON text
   * @returns {void}
   */
  function onControlData(text) {
    const message = decodeControlMessage(text);
    if (!message) return;
    const recvTs = clock();
    switch (message.t) {
      case CONTROL_MESSAGE.PROBE:
        sendControl(buildProbeAck(message, clock()));
        return;
      case CONTROL_MESSAGE.HELLO:
        cb.onHello(message);
        sendControl({ t: CONTROL_MESSAGE.HELLO, role: 'panel', surface, clock: clock() });
        return;
      case CONTROL_MESSAGE.BUTTON:
      case CONTROL_MESSAGE.CLICK:
      case CONTROL_MESSAGE.KEY:
        stats.discreteEvents += 1;
        withApplyDelay(() => {
          if (message.t === CONTROL_MESSAGE.BUTTON) {
            const mask = 1 << message.button;
            cursor.buttons = message.down ? cursor.buttons | mask : cursor.buttons & ~mask;
            cb.onCursor({ ...cursor });
          }
          cb.onEvent({ ...message, recvTs });
          sendControl(buildAck(message.seq, recvTs, clock()));
        });
        cb.onStats({ ...stats });
        return;
      case CONTROL_MESSAGE.STOP:
        cb.onEvent({ ...message, recvTs });
        return;
      default:
        return;
    }
  }

  /**
   * Clears per-session state: counters, the control channel and any held button.
   * @returns {void}
   */
  function reset() {
    controlChannel = null;
    stats.pointerFrames = 0;
    stats.pointerLost = 0;
    stats.discreteEvents = 0;
    stats.lastSeq = -1;
    releaseHeldButtons();
    cb.onStats({ ...stats });
  }

  /**
   * Marks the start of a controller session. The first channel of a new
   * session resets the receiver; the second channel of the same session does not.
   * @param {string} sessionId - the cymcast session id
   * @returns {boolean} true when a new session started (state was reset)
   */
  function beginSession(sessionId) {
    const id = sessionId == null ? '' : String(sessionId);
    if (hasSession && id === currentSessionId) return false;
    hasSession = true;
    currentSessionId = id;
    reset();
    return true;
  }

  /**
   * Binds a DataChannel by label.
   * @param {RTCDataChannel} channel - an incoming channel
   * @param {string} [sessionId] - when given, begins that session first
   * @returns {boolean} true when the label was recognised
   */
  function attachChannel(channel, sessionId) {
    if (sessionId !== undefined) beginSession(sessionId);
    if (channel.label === 'pointer') {
      channel.binaryType = 'arraybuffer';
      channel.onmessage = (event) => onPointerData(event.data);
      return true;
    }
    if (channel.label === 'control') {
      controlChannel = channel;
      channel.onmessage = (event) => onControlData(event.data);
      channel.onclose = () => {
        // A stale channel from an earlier channel set must not touch the live session.
        if (controlChannel !== channel) return;
        controlChannel = null;
        releaseHeldButtons();
      };
      return true;
    }
    return false;
  }

  return {
    attachChannel,
    beginSession,
    onPointerData,
    onControlData,
    setApplyDelay(ms) {
      delay = Math.max(0, ms || 0);
    },
    getCursor: () => ({ ...cursor }),
    getStats: () => ({ ...stats }),
    reset,
  };
}
