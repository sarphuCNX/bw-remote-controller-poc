// Pointer frame codec — the binary payload of the unordered, no-retransmit
// `pointer` DataChannel. One frame per animation tick when there is movement.
//
// Layout (16 bytes, little-endian):
//   u16 seq      per-session frame counter (wraps)
//   u32 tsMs     controller clock, ms (wraps every ~49 days; only deltas matter)
//   i16 dx       relative pointer delta, or u16 x (0..65535) in absolute mode
//   i16 dy       relative pointer delta, or u16 y (0..65535) in absolute mode
//   i16 wheelX   scroll delta
//   i16 wheelY   scroll delta
//   u8  buttons  RFB-style mask: bit0 left, bit1 middle, bit2 right
//   u8  flags    bit0 = absolute mode

export const POINTER_FRAME_BYTES = 16;
export const FLAG_ABSOLUTE = 0x01;
export const BUTTON_LEFT = 0x01;
export const BUTTON_MIDDLE = 0x02;
export const BUTTON_RIGHT = 0x04;

const INT16_MIN = -32768;
const INT16_MAX = 32767;
const UINT16_MAX = 65535;

/**
 * Clamps a number into the signed 16-bit range.
 * @param {number} value - any number
 * @returns {number} the clamped integer
 */
function clampInt16(value) {
  return Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(value || 0)));
}

/**
 * Clamps a number into the unsigned 16-bit range.
 * @param {number} value - any number
 * @returns {number} the clamped integer
 */
function clampUint16(value) {
  return Math.max(0, Math.min(UINT16_MAX, Math.round(value || 0)));
}

/**
 * Encodes a pointer frame.
 * @param {object} frame - the frame fields
 * @param {number} frame.seq - frame counter
 * @param {number} frame.tsMs - controller timestamp in ms
 * @param {number} [frame.dx] - relative delta x (or absolute x when absolute)
 * @param {number} [frame.dy] - relative delta y (or absolute y when absolute)
 * @param {number} [frame.wheelX] - scroll delta x
 * @param {number} [frame.wheelY] - scroll delta y
 * @param {number} [frame.buttons] - button mask
 * @param {boolean} [frame.absolute] - absolute mode (x, y in 0..65535)
 * @returns {ArrayBuffer} the 16-byte frame
 */
export function encodePointerFrame(frame) {
  const buffer = new ArrayBuffer(POINTER_FRAME_BYTES);
  const view = new DataView(buffer);
  const absolute = !!frame.absolute;
  view.setUint16(0, (frame.seq >>> 0) & 0xffff, true);
  view.setUint32(2, (frame.tsMs >>> 0) & 0xffffffff, true);
  if (absolute) {
    view.setUint16(6, clampUint16(frame.dx), true);
    view.setUint16(8, clampUint16(frame.dy), true);
  } else {
    view.setInt16(6, clampInt16(frame.dx), true);
    view.setInt16(8, clampInt16(frame.dy), true);
  }
  view.setInt16(10, clampInt16(frame.wheelX), true);
  view.setInt16(12, clampInt16(frame.wheelY), true);
  view.setUint8(14, (frame.buttons || 0) & 0xff);
  view.setUint8(15, absolute ? FLAG_ABSOLUTE : 0);
  return buffer;
}

/**
 * Decodes a pointer frame.
 * @param {ArrayBuffer|Uint8Array} data - the received bytes
 * @returns {{seq: number, tsMs: number, dx: number, dy: number, wheelX: number, wheelY: number, buttons: number, absolute: boolean}} the frame
 * @throws {Error} when the payload is not exactly 16 bytes
 */
export function decodePointerFrame(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength !== POINTER_FRAME_BYTES) {
    throw new Error(`pointer frame must be ${POINTER_FRAME_BYTES} bytes, got ${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = view.getUint8(15);
  const absolute = (flags & FLAG_ABSOLUTE) !== 0;
  return {
    seq: view.getUint16(0, true),
    tsMs: view.getUint32(2, true),
    dx: absolute ? view.getUint16(6, true) : view.getInt16(6, true),
    dy: absolute ? view.getUint16(8, true) : view.getInt16(8, true),
    wheelX: view.getInt16(10, true),
    wheelY: view.getInt16(12, true),
    buttons: view.getUint8(14),
    absolute,
  };
}

/**
 * Counts frames lost between two consecutive received sequence numbers,
 * tolerating the u16 wrap.
 * @param {number} previousSeq - last received seq, or -1 when none
 * @param {number} seq - the seq just received
 * @returns {number} how many frames were skipped (0 when in order)
 */
export function countSeqGap(previousSeq, seq) {
  if (previousSeq < 0) return 0;
  const expected = (previousSeq + 1) & 0xffff;
  const gap = (seq - expected + 0x10000) & 0xffff;
  // A gap larger than half the space means an old/reordered frame, not loss.
  return gap > 0x7fff ? 0 : gap;
}
