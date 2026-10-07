// Latency probe — periodic probe/probe-ack round trips over whichever path is
// active, producing RTT samples and an estimated clock offset to the panel.

import { CONTROL_MESSAGE } from '../protocol/control-messages';
import { createSampleRing } from './stats';

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_CAPACITY = 60;

/**
 * Creates a latency probe.
 * @param {object} options - configuration
 * @param {function(object): boolean} options.send - sends a probe message; returns false when not sent
 * @param {function(): number} [options.now] - clock in ms (default performance.now)
 * @param {function} [options.setInterval] - injectable timer
 * @param {function} [options.clearInterval] - injectable timer clear
 * @param {number} [options.intervalMs] - probe period
 * @param {number} [options.capacity] - samples kept
 * @returns {{start: function(): void, stop: function(): void, sendOnce: function(): void, onMessage: function(object): boolean, rttSamples: function(): number[], clockOffsetMs: function(): number|null}} the probe
 */
export function createLatencyProbe({
  send,
  now,
  setInterval: setIntervalImpl,
  clearInterval: clearIntervalImpl,
  intervalMs = DEFAULT_INTERVAL_MS,
  capacity = DEFAULT_CAPACITY,
}) {
  const clock = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const schedule = setIntervalImpl || ((fn, ms) => setInterval(fn, ms));
  const unschedule = clearIntervalImpl || ((id) => clearInterval(id));
  const rtts = createSampleRing(capacity);
  const inFlight = new Map();
  let nextId = 1;
  let timer = null;
  let clockOffset = null;

  function sendOnce() {
    const id = nextId;
    nextId += 1;
    const ts = clock();
    if (send({ t: CONTROL_MESSAGE.PROBE, id, ts })) inFlight.set(id, ts);
    // Keep the in-flight map bounded if acks never come back.
    if (inFlight.size > capacity) inFlight.delete(inFlight.keys().next().value);
  }

  /**
   * Feeds a received message; consumes probe acks.
   * @param {object} message - a decoded control message
   * @returns {boolean} true when the message was a probe ack and was consumed
   */
  function onMessage(message) {
    if (!message || message.t !== CONTROL_MESSAGE.PROBE_ACK) return false;
    const sentAt = inFlight.get(message.id);
    if (sentAt === undefined) return true;
    inFlight.delete(message.id);
    const receivedAt = clock();
    const rtt = receivedAt - sentAt;
    rtts.push(rtt);
    if (typeof message.panelTs === 'number') {
      // NTP-style: panel clock at the midpoint of the round trip.
      clockOffset = message.panelTs - (sentAt + rtt / 2);
    }
    return true;
  }

  return {
    start() {
      if (timer) return;
      sendOnce();
      timer = schedule(sendOnce, intervalMs);
    },
    stop() {
      if (timer) unschedule(timer);
      timer = null;
    },
    sendOnce,
    onMessage,
    rttSamples: () => rtts.values(),
    clockOffsetMs: () => clockOffset,
  };
}
