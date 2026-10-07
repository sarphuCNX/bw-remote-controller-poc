import { encodePointerFrame } from '../../shared/protocol/pointer-frame';
import { createControlReceiver } from './control-receiver';

/**
 * Builds a receiver with a manual clock, a fake control channel and captured callbacks.
 * @param {object} [options] - receiver options override
 * @returns {object} the harness
 */
function createHarness(options = {}) {
  let time = 100;
  const cursors = [];
  const events = [];
  const sentControl = [];
  const controlChannel = {
    label: 'control',
    readyState: 'open',
    send: (text) => sentControl.push(JSON.parse(text)),
  };
  const pointerChannel = { label: 'pointer', readyState: 'open' };
  const receiver = createControlReceiver({
    surface: { width: 1000, height: 500 },
    now: () => time,
    callbacks: { onCursor: (c) => cursors.push(c), onEvent: (e) => events.push(e) },
    ...options,
  });
  receiver.attachChannel(controlChannel);
  receiver.attachChannel(pointerChannel);
  return {
    receiver,
    cursors,
    events,
    sentControl,
    controlChannel,
    pointerChannel,
    tick: (ms) => (time += ms),
  };
}

describe('createControlReceiver pointer', () => {
  test('pointerFrame_withRelativeDelta_movesCursorFromCentre', () => {
    const { receiver, pointerChannel, cursors } = createHarness();

    pointerChannel.onmessage({ data: encodePointerFrame({ seq: 1, tsMs: 0, dx: 10, dy: -20 }) });

    expect(cursors[0]).toMatchObject({ x: 510, y: 230 });
    expect(receiver.getCursor()).toMatchObject({ x: 510, y: 230 });
  });

  test('pointerFrame_beyondSurface_clampsCursor', () => {
    const { pointerChannel, cursors } = createHarness();

    pointerChannel.onmessage({ data: encodePointerFrame({ seq: 1, tsMs: 0, dx: 5000, dy: 5000 }) });

    expect(cursors[0]).toMatchObject({ x: 1000, y: 500 });
  });

  test('pointerFrames_withSeqGap_countsLostFrames', () => {
    const { receiver, pointerChannel } = createHarness();

    pointerChannel.onmessage({ data: encodePointerFrame({ seq: 1, tsMs: 0 }) });
    pointerChannel.onmessage({ data: encodePointerFrame({ seq: 4, tsMs: 0 }) });

    expect(receiver.getStats()).toMatchObject({ pointerFrames: 2, pointerLost: 2, lastSeq: 4 });
  });

  test('pointerFrame_withButtonsSet_doesNotChangeButtonState', () => {
    const { receiver, pointerChannel } = createHarness();

    pointerChannel.onmessage({ data: encodePointerFrame({ seq: 1, tsMs: 0, dx: 1, dy: 1, buttons: 1 }) });

    expect(receiver.getCursor().buttons).toBe(0);
  });

  test('reset_clearsCountersAndLastSeq', () => {
    const { receiver, pointerChannel } = createHarness();
    pointerChannel.onmessage({ data: encodePointerFrame({ seq: 40000, tsMs: 0 }) });

    receiver.reset();
    pointerChannel.onmessage({ data: encodePointerFrame({ seq: 1, tsMs: 0 }) });

    expect(receiver.getStats()).toMatchObject({ pointerFrames: 1, pointerLost: 0, lastSeq: 1 });
  });

  test('pointerFrame_withGarbage_isIgnored', () => {
    const { receiver, pointerChannel } = createHarness();

    pointerChannel.onmessage({ data: new Uint8Array(3) });

    expect(receiver.getStats().pointerFrames).toBe(0);
  });
});

describe('createControlReceiver control messages', () => {
  test('buttonDown_appliesMaskAndSendsAckWithTimestamps', () => {
    const { controlChannel, sentControl, receiver, tick } = createHarness();

    controlChannel.onmessage({ data: JSON.stringify({ t: 'button', button: 0, down: true, seq: 7 }) });
    tick(0);

    expect(receiver.getCursor().buttons).toBe(1);
    expect(sentControl[0]).toEqual({ t: 'ack', seq: 7, recvTs: 100, applyTs: 100 });
  });

  test('keyEvent_isReportedAndAcked', () => {
    const { controlChannel, events, sentControl } = createHarness();

    controlChannel.onmessage({
      data: JSON.stringify({ t: 'key', key: 'a', code: 'KeyA', down: true, seq: 2, mods: {} }),
    });

    expect(events[0]).toMatchObject({ t: 'key', key: 'a', seq: 2 });
    expect(sentControl[0]).toMatchObject({ t: 'ack', seq: 2 });
  });

  test('probe_isAnsweredWithPanelClock', () => {
    const { controlChannel, sentControl } = createHarness();

    controlChannel.onmessage({ data: JSON.stringify({ t: 'probe', id: 5, ts: 999 }) });

    expect(sentControl[0]).toEqual({ t: 'probe-ack', id: 5, ts: 999, panelTs: 100 });
  });

  test('hello_isAnsweredWithSurface', () => {
    const { controlChannel, sentControl } = createHarness();

    controlChannel.onmessage({ data: JSON.stringify({ t: 'hello', role: 'controller' }) });

    expect(sentControl[0]).toMatchObject({ t: 'hello', role: 'panel', surface: { width: 1000, height: 500 } });
  });

  test('invalidJson_isIgnored', () => {
    const { controlChannel, sentControl } = createHarness();

    expect(() => controlChannel.onmessage({ data: '{bad' })).not.toThrow();
    expect(sentControl).toHaveLength(0);
  });

  test('applyDelay_deferredApplyAndAck', () => {
    const scheduled = [];
    const { controlChannel, sentControl, tick } = createHarness({
      applyDelayMs: 20,
      setTimeout: (fn, ms) => scheduled.push({ fn, ms }),
    });

    controlChannel.onmessage({ data: JSON.stringify({ t: 'click', button: 0, seq: 1 }) });

    expect(sentControl).toHaveLength(0);
    tick(20);
    scheduled[0].fn();
    expect(sentControl[0]).toEqual({ t: 'ack', seq: 1, recvTs: 100, applyTs: 120 });
  });

  test('attachChannel_withUnknownLabel_returnsFalse', () => {
    const receiver = createControlReceiver();

    expect(receiver.attachChannel({ label: 'video' })).toBe(false);
  });
});
