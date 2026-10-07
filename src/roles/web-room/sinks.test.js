import { decodePointerFrame } from '../../shared/protocol/pointer-frame';
import { createDataChannelSink, createSocketSink } from './sinks';

/**
 * Minimal RTCDataChannel stand-in.
 * @param {string} readyState - channel state
 * @returns {{readyState: string, sent: Array, send: function}} the fake channel
 */
function fakeChannel(readyState = 'open') {
  const sent = [];
  return { readyState, sent, send: (data) => sent.push(data) };
}

describe('createDataChannelSink', () => {
  test('sendPointer_whenOpen_sendsEncodedBinaryFrame', () => {
    const pointerChannel = fakeChannel();
    const sink = createDataChannelSink({ pointerChannel, controlChannel: fakeChannel() });

    sink.sendPointer({ seq: 3, tsMs: 1, dx: 5, dy: -5 });

    expect(decodePointerFrame(pointerChannel.sent[0])).toMatchObject({ seq: 3, dx: 5, dy: -5 });
  });

  test('sendDiscrete_whenOpen_sendsJson', () => {
    const controlChannel = fakeChannel();
    const sink = createDataChannelSink({ pointerChannel: fakeChannel(), controlChannel });

    sink.sendDiscrete({ t: 'click', button: 0, seq: 1 });

    expect(JSON.parse(controlChannel.sent[0])).toEqual({ t: 'click', button: 0, seq: 1 });
  });

  test('isConnected_whenEitherChannelNotOpen_returnsFalse', () => {
    const sink = createDataChannelSink({
      pointerChannel: fakeChannel('open'),
      controlChannel: fakeChannel('connecting'),
    });

    expect(sink.isConnected()).toBe(false);
  });

  test('sendPointer_whenChannelClosed_doesNotThrowOrSend', () => {
    const pointerChannel = fakeChannel('closed');
    const sink = createDataChannelSink({ pointerChannel, controlChannel: fakeChannel() });

    expect(() => sink.sendPointer({ seq: 1, tsMs: 1 })).not.toThrow();
    expect(pointerChannel.sent).toHaveLength(0);
  });
});

describe('createSocketSink', () => {
  /**
   * @returns {{sink: object, emitted: Array}} a sink over a recording emitter
   */
  function createHarness() {
    const emitted = [];
    const sink = createSocketSink({
      emit: (channel, payload) => emitted.push([channel, payload]),
      isConnected: () => true,
      surface: { width: 1000, height: 500 },
    });
    return { sink, emitted };
  }

  test('sendPointer_withRelativeDelta_emitsAbsoluteNormalizedMouseMove', () => {
    const { sink, emitted } = createHarness();

    sink.sendPointer({ seq: 1, tsMs: 0, dx: 100, dy: -50 });

    expect(emitted[0]).toEqual(['REMOTE_CONTROL', { type: 'MOUSE_MOVE', x: 0.6, y: 0.4 }]);
  });

  test('sendPointer_withDeltaBeyondSurface_clampsCursor', () => {
    const { sink, emitted } = createHarness();

    sink.sendPointer({ seq: 1, tsMs: 0, dx: 99999, dy: 0 });

    expect(emitted[0][1].x).toBe(1);
  });

  test('sendPointer_withWheel_emitsWheel', () => {
    const { sink, emitted } = createHarness();

    sink.sendPointer({ seq: 1, tsMs: 0, dx: 0, dy: 0, wheelX: 0, wheelY: 120 });

    expect(emitted).toEqual([['REMOTE_CONTROL', { type: 'WHEEL', x: 0, y: 120 }]]);
  });

  test('sendDiscrete_leftButtonDownAndUp_emitsMouseDownThenMouseUp', () => {
    const { sink, emitted } = createHarness();

    sink.sendDiscrete({ t: 'button', button: 0, down: true });
    sink.sendDiscrete({ t: 'button', button: 0, down: false });

    expect(emitted.map(([, p]) => p.type)).toEqual(['MOUSE_DOWN', 'MOUSE_UP']);
  });

  test('sendDiscrete_keyDown_emitsKeyboardPressWithModifiers', () => {
    const { sink, emitted } = createHarness();

    sink.sendDiscrete({ t: 'key', key: 'a', code: 'KeyA', down: true, mods: { ctrl: true } });

    expect(emitted[0][1]).toEqual({
      type: 'KEYBOARD_PRESS',
      key: 'a',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    });
  });

  test('sendDiscrete_keyUp_emitsNothing_v1HasNoKeyUp', () => {
    const { sink, emitted } = createHarness();

    sink.sendDiscrete({ t: 'key', key: 'a', code: 'KeyA', down: false, mods: {} });

    expect(emitted).toHaveLength(0);
  });

  test('sendPointer_whenDisconnected_emitsNothing', () => {
    const emitted = [];
    const sink = createSocketSink({ emit: (c, p) => emitted.push(p), isConnected: () => false });

    sink.sendPointer({ seq: 1, tsMs: 0, dx: 1, dy: 1 });

    expect(emitted).toHaveLength(0);
  });
});
