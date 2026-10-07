import {
  CONTROL_MESSAGE,
  buildAck,
  buildProbeAck,
  decodeControlMessage,
  encodeControlMessage,
} from './control-messages';

describe('control messages', () => {
  test('encode_thenDecode_roundTrips', () => {
    const message = { t: CONTROL_MESSAGE.KEY, seq: 3, key: 'a', code: 'KeyA', down: true, mods: {} };

    const decoded = decodeControlMessage(encodeControlMessage(message));

    expect(decoded).toEqual(message);
  });

  test('decode_withInvalidJson_returnsNull', () => {
    expect(decodeControlMessage('{not json')).toBeNull();
  });

  test('decode_withoutTypeField_returnsNull', () => {
    expect(decodeControlMessage('{"seq":1}')).toBeNull();
  });

  test('buildAck_returnsAckWithTimestamps', () => {
    const ack = buildAck(7, 100, 101);

    expect(ack).toEqual({ t: 'ack', seq: 7, recvTs: 100, applyTs: 101 });
  });

  test('buildProbeAck_echoesProbeIdAndTimestamp', () => {
    const reply = buildProbeAck({ id: 4, ts: 999 }, 1234);

    expect(reply).toEqual({ t: 'probe-ack', id: 4, ts: 999, panelTs: 1234 });
  });
});
