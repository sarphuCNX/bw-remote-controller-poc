import { buildGestureScript, runGestureScript } from './gesture-script';

describe('buildGestureScript', () => {
  test('build_isDeterministic', () => {
    expect(buildGestureScript({ durationMs: 8000 })).toEqual(buildGestureScript({ durationMs: 8000 }));
  });

  test('build_coversMovesDragScrollAndKeys', () => {
    const kinds = new Set(buildGestureScript({ durationMs: 4000 }).map((s) => s.kind));

    expect([...kinds].sort()).toEqual(['button', 'key', 'move', 'scroll']);
  });

  test('build_pairsEveryButtonDownWithAnUp', () => {
    const buttons = buildGestureScript({ durationMs: 12000 }).filter((s) => s.kind === 'button');

    expect(buttons.filter((b) => b.down).length).toBe(buttons.filter((b) => !b.down).length);
  });

  test('build_stepsAreTimeOrdered', () => {
    const steps = buildGestureScript({ durationMs: 8000 });

    for (let i = 1; i < steps.length; i += 1) expect(steps[i].at).toBeGreaterThanOrEqual(steps[i - 1].at);
  });
});

describe('runGestureScript', () => {
  /**
   * @returns {{pipeline: object, calls: string[]}} a recording pipeline
   */
  function recordingPipeline() {
    const calls = [];
    return {
      calls,
      pipeline: {
        move: (dx, dy) => calls.push(`move:${dx},${dy}`),
        scroll: (x, y) => calls.push(`scroll:${y}`),
        button: (b, d) => calls.push(`button:${b}:${d}`),
        key: ({ key, down }) => calls.push(`key:${key}:${down}`),
        releaseAll: () => calls.push('releaseAll'),
      },
    };
  }

  test('run_appliesStepsInOrderThenReleasesAndSignalsDone', () => {
    const { pipeline, calls } = recordingPipeline();
    const queue = [];
    let done = false;
    const steps = [
      { at: 0, kind: 'move', dx: 1, dy: 2 },
      { at: 16, kind: 'button', button: 0, down: true },
      { at: 32, kind: 'key', key: 'a', down: true },
    ];

    runGestureScript({ steps, pipeline, setTimeout: (fn) => queue.push(fn), onDone: () => (done = true) });
    while (queue.length) queue.shift()();

    expect(calls).toEqual(['move:1,2', 'button:0:true', 'key:a:true', 'releaseAll']);
    expect(done).toBe(true);
  });

  test('cancel_stopsFurtherSteps', () => {
    const { pipeline, calls } = recordingPipeline();
    const queue = [];
    const steps = [
      { at: 0, kind: 'move', dx: 1, dy: 2 },
      { at: 16, kind: 'move', dx: 3, dy: 4 },
    ];

    const handle = runGestureScript({ steps, pipeline, setTimeout: (fn) => queue.push(fn) });
    queue.shift()();
    handle.cancel();
    while (queue.length) queue.shift()();

    expect(calls).toEqual(['move:1,2']);
  });
});
