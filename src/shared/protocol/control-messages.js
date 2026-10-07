// Control-channel messages — the reliable, ordered `control` DataChannel.
// JSON for readability in the POC; production would use a compact envelope.

export const CONTROL_MESSAGE = Object.freeze({
  HELLO: 'hello',
  KEY: 'key',
  BUTTON: 'button',
  CLICK: 'click',
  ACK: 'ack',
  PROBE: 'probe',
  PROBE_ACK: 'probe-ack',
  STOP: 'stop',
});

export const CHANNEL_LABEL = Object.freeze({
  POINTER: 'pointer',
  CONTROL: 'control',
});

/**
 * Serializes a control message.
 * @param {object} message - a message with a `t` field
 * @returns {string} JSON text
 */
export function encodeControlMessage(message) {
  return JSON.stringify(message);
}

/**
 * Parses a control message, tolerating garbage.
 * @param {string} text - the received text
 * @returns {object|null} the message, or null when unparsable or without `t`
 */
export function decodeControlMessage(text) {
  try {
    const message = JSON.parse(text);
    return message && typeof message.t === 'string' ? message : null;
  } catch (_) {
    return null;
  }
}

/**
 * Builds an ack for a discrete event.
 * @param {number} seq - the acknowledged sequence number
 * @param {number} recvTs - panel clock when received
 * @param {number} applyTs - panel clock when applied
 * @returns {{t: string, seq: number, recvTs: number, applyTs: number}} the ack
 */
export function buildAck(seq, recvTs, applyTs) {
  return { t: CONTROL_MESSAGE.ACK, seq, recvTs, applyTs };
}

/**
 * Builds a probe reply.
 * @param {object} probe - the received probe (id, ts)
 * @param {number} panelTs - panel clock when answering
 * @returns {{t: string, id: number, ts: number, panelTs: number}} the reply
 */
export function buildProbeAck(probe, panelTs) {
  return { t: CONTROL_MESSAGE.PROBE_ACK, id: probe.id, ts: probe.ts, panelTs };
}
