import { createInputPipeline } from './input-pipeline';

/**
 * Builds a pipeline over a recording sink with a manual animation frame.
 * @param {{connected?: boolean}} [options] - sink connectivity
 * @returns {{pipeline: object, pointers: object[], discretes: object[], runFrame: function(): void}} the harness
 */
function createHarness({ connected = true } = {}) {
  const pointers = [];
  const discretes = [];
  let frameCallback = null;
  const sink = {
    sendPointer: (frame) => pointers.push(frame),
    sendDiscrete: (message) => discretes.push(message),
    isConnected: () => connected,
  };
  const pipeline = createInputPipeline({
    sink,
    requestFrame: (fn) => {
      frameCallback = fn;
      return 1;
    },
    cancelFrame: () => {
      frameCallback = null;
    },
    now: () => 5000,
  });
  const runFrame = () => {
    const fn = frameCallback;
    frameCallback = null;
    if (fn) fn();
  };
  return { pipeline, pointers, discretes, runFrame };
}

describe('createInputPipeline pointer coalescing', () => {
  test('move_calledThreeTimesBeforeFrame_sendsOneSummedFrame', () => {
    const { pipeline, pointers, runFrame } = createHarness();

    pipeline.move(1, 2);
    pipeline.move(3, 4);
    pipeline.move(-1, 0);
    runFrame();

    expect(pointers).toHaveLength(1);
    expect(pointers[0]).toMatchObject({ dx: 3, dy: 6, seq: 1, tsMs: 5000, absolute: false });
  });

  test('scroll_andMove_inSameFrame_shareOneFrame', () => {
    const { pipeline, pointers, runFrame } = createHarness();

    pipeline.move(2, 0);
    pipeline.scroll(0, -120);
    runFrame();

    expect(pointers[0]).toMatchObject({ dx: 2, dy: 0, wheelX: 0, wheelY: -120 });
  });

  test('moveAbsolute_setsAbsoluteFlagAndCoordinates', () => {
    const { pipeline, pointers, runFrame } = createHarness();

    pipeline.moveAbsolute(100, 200);
    runFrame();

    expect(pointers[0]).toMatchObject({ absolute: true, dx: 100, dy: 200 });
  });

  test('move_whenNoFrameRuns_sendsNothing', () => {
    const { pipeline, pointers } = createHarness();

    pipeline.move(1, 1);

    expect(pointers).toHaveLength(0);
  });

  test('move_whenSinkDisconnected_dropsTheFrame', () => {
    const { pipeline, pointers, runFrame } = createHarness({ connected: false });

    pipeline.move(1, 1);
    runFrame();

    expect(pointers).toHaveLength(0);
  });

  test('pointerFrames_carryCurrentButtonMask', () => {
    const { pipeline, pointers, runFrame } = createHarness();

    pipeline.button(0, true);
    pipeline.move(1, 0);
    runFrame();

    expect(pointers[0].buttons).toBe(1);
  });
});

describe('createInputPipeline discrete events', () => {
  test('button_down_sendsSequencedButtonMessage', () => {
    const { pipeline, discretes } = createHarness();

    pipeline.button(0, true);

    expect(discretes).toEqual([{ t: 'button', button: 0, down: true, seq: 1, ts: 5000 }]);
  });

  test('key_down_thenUp_sendsInOrderWithIncreasingSeq', () => {
    const { pipeline, discretes } = createHarness();

    pipeline.key({ key: 'a', code: 'KeyA', down: true, mods: { shift: false } });
    pipeline.key({ key: 'a', code: 'KeyA', down: false, mods: { shift: false } });

    expect(discretes.map((m) => [m.seq, m.down])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  test('click_sendsClickMessage', () => {
    const { pipeline, discretes } = createHarness();

    pipeline.click(2);

    expect(discretes[0]).toMatchObject({ t: 'click', button: 2, seq: 1 });
  });

  test('discrete_whenSinkDisconnected_returnsNullAndSendsNothing', () => {
    const { pipeline, discretes } = createHarness({ connected: false });

    const sent = pipeline.button(0, true);

    expect(sent).toBeNull();
    expect(discretes).toHaveLength(0);
  });

  test('releaseAll_withHeldButtons_sendsUpForEachHeldButton', () => {
    const { pipeline, discretes } = createHarness();
    pipeline.button(0, true);
    pipeline.button(2, true);

    pipeline.releaseAll();

    const ups = discretes.filter((m) => m.t === 'button' && !m.down).map((m) => m.button);
    expect(ups).toEqual([0, 2]);
    expect(pipeline.heldButtons()).toBe(0);
  });

  test('button_whenSinkDisconnected_doesNotChangeHeldButtons', () => {
    const { pipeline } = createHarness({ connected: false });

    pipeline.button(0, true);

    expect(pipeline.heldButtons()).toBe(0);
  });

  test('button_withUnknownButtonIndex_returnsNullAndSendsNothing', () => {
    const { pipeline, discretes } = createHarness();

    const sent = pipeline.button(-1, false);

    expect(sent).toBeNull();
    expect(discretes).toHaveLength(0);
  });

  test('setSink_routesSubsequentEventsToNewSink', () => {
    const { pipeline, discretes } = createHarness();
    const other = [];
    pipeline.setSink({
      sendPointer: () => {},
      sendDiscrete: (m) => other.push(m),
      isConnected: () => true,
    });

    pipeline.click(0);

    expect(discretes).toHaveLength(0);
    expect(other).toHaveLength(1);
  });
});
