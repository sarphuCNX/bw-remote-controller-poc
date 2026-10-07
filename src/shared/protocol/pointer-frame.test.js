import {
  BUTTON_LEFT,
  BUTTON_RIGHT,
  POINTER_FRAME_BYTES,
  countSeqGap,
  decodePointerFrame,
  encodePointerFrame,
} from './pointer-frame';

describe('encodePointerFrame and decodePointerFrame', () => {
  test('encode_thenDecode_relativeFrame_roundTripsAllFields', () => {
    const frame = {
      seq: 42,
      tsMs: 123456,
      dx: -7,
      dy: 13,
      wheelX: 0,
      wheelY: -120,
      buttons: BUTTON_LEFT | BUTTON_RIGHT,
      absolute: false,
    };

    const decoded = decodePointerFrame(encodePointerFrame(frame));

    expect(decoded).toEqual(frame);
  });

  test('encode_thenDecode_absoluteFrame_keepsUnsignedCoordinates', () => {
    const frame = {
      seq: 1,
      tsMs: 10,
      dx: 65535,
      dy: 40000,
      wheelX: 0,
      wheelY: 0,
      buttons: 0,
      absolute: true,
    };

    const decoded = decodePointerFrame(encodePointerFrame(frame));

    expect(decoded).toEqual(frame);
  });

  test('encode_withOutOfRangeDelta_clampsToInt16', () => {
    const encoded = encodePointerFrame({ seq: 0, tsMs: 0, dx: 99999, dy: -99999 });

    const decoded = decodePointerFrame(encoded);

    expect(decoded.dx).toBe(32767);
    expect(decoded.dy).toBe(-32768);
  });

  test('encode_withSeqAbove16Bits_wraps', () => {
    const encoded = encodePointerFrame({ seq: 65536 + 5, tsMs: 0 });

    const decoded = decodePointerFrame(encoded);

    expect(decoded.seq).toBe(5);
  });

  test('encode_always_produces16Bytes', () => {
    const encoded = encodePointerFrame({ seq: 0, tsMs: 0 });

    expect(encoded.byteLength).toBe(POINTER_FRAME_BYTES);
  });

  test('decode_withWrongLength_throws', () => {
    const tooShort = new Uint8Array(15);

    expect(() => decodePointerFrame(tooShort)).toThrow(/16 bytes/);
  });

  test('decode_withUint8ArrayView_readsFromOffset', () => {
    const encoded = new Uint8Array(encodePointerFrame({ seq: 9, tsMs: 1, dx: 3, dy: 4 }));
    const padded = new Uint8Array(POINTER_FRAME_BYTES + 4);
    padded.set(encoded, 4);
    const view = new Uint8Array(padded.buffer, 4, POINTER_FRAME_BYTES);

    const decoded = decodePointerFrame(view);

    expect(decoded.seq).toBe(9);
    expect(decoded.dx).toBe(3);
  });
});

describe('countSeqGap', () => {
  test('countSeqGap_withConsecutiveSeq_returnsZero', () => {
    expect(countSeqGap(10, 11)).toBe(0);
  });

  test('countSeqGap_withSkippedFrames_returnsCount', () => {
    expect(countSeqGap(10, 14)).toBe(3);
  });

  test('countSeqGap_acrossWrap_returnsCount', () => {
    expect(countSeqGap(65534, 1)).toBe(2);
  });

  test('countSeqGap_withNoPrevious_returnsZero', () => {
    expect(countSeqGap(-1, 500)).toBe(0);
  });

  test('countSeqGap_withOldFrame_returnsZero', () => {
    expect(countSeqGap(20, 18)).toBe(0);
  });
});
