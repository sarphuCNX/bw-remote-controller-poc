// Scripted gesture set — a deterministic sequence of input the web room can
// replay through the pipeline, so measurement runs are repeatable across paths
// and impairment profiles. Pure: returns steps with relative times.

export const DEFAULT_SCRIPT_MS = 60000;
const TICK_MS = 1000 / 60;

/**
 * Builds the gesture steps.
 * @param {object} [options] - configuration
 * @param {number} [options.durationMs] - total length
 * @param {number} [options.tickMs] - pointer tick
 * @returns {Array<{at: number, kind: string, dx?: number, dy?: number, wheelY?: number, button?: number, down?: boolean, key?: string}>} ordered steps
 */
export function buildGestureScript({ durationMs = DEFAULT_SCRIPT_MS, tickMs = TICK_MS } = {}) {
  const steps = [];
  let t = 0;
  const cycleMs = 4000;
  while (t < durationMs) {
    const phase = (t % cycleMs) / cycleMs;
    if (phase < 0.5) {
      // Circle: smooth continuous motion, 60 Hz.
      const angle = (phase / 0.5) * Math.PI * 2;
      steps.push({ at: t, kind: 'move', dx: Math.round(Math.cos(angle) * 12), dy: Math.round(Math.sin(angle) * 12) });
    } else if (phase < 0.75) {
      // Drag: left button held while moving right.
      const dragStart = Math.abs(phase - 0.5) < tickMs / cycleMs;
      if (dragStart) steps.push({ at: t, kind: 'button', button: 0, down: true });
      steps.push({ at: t, kind: 'move', dx: 8, dy: 0 });
    } else {
      const dragEnd = Math.abs(phase - 0.75) < tickMs / cycleMs;
      if (dragEnd) steps.push({ at: t, kind: 'button', button: 0, down: false });
      // Scroll and a key burst.
      if (Math.round(t / tickMs) % 6 === 0) steps.push({ at: t, kind: 'scroll', wheelY: -40 });
      if (Math.round(t / tickMs) % 15 === 0) {
        steps.push({ at: t, kind: 'key', key: 'a', down: true });
        steps.push({ at: t + tickMs / 2, kind: 'key', key: 'a', down: false });
      }
    }
    t += tickMs;
  }
  return steps;
}

/**
 * Replays a script through a pipeline using an injectable scheduler.
 * @param {object} options - configuration
 * @param {Array} options.steps - from buildGestureScript
 * @param {object} options.pipeline - the input pipeline
 * @param {function(function, number): number} [options.setTimeout] - injectable timer
 * @param {function(): void} [options.onDone] - called after the last step
 * @returns {{cancel: function(): void}} a handle
 */
export function runGestureScript({ steps, pipeline, setTimeout: later, onDone }) {
  const schedule = later || ((fn, ms) => setTimeout(fn, ms));
  let cancelled = false;
  let index = 0;
  const startAt = 0;

  function apply(step) {
    if (step.kind === 'move') pipeline.move(step.dx, step.dy);
    else if (step.kind === 'scroll') pipeline.scroll(0, step.wheelY);
    else if (step.kind === 'button') pipeline.button(step.button, step.down);
    else if (step.kind === 'key') pipeline.key({ key: step.key, code: `Key${step.key.toUpperCase()}`, down: step.down, mods: {} });
  }

  function next() {
    if (cancelled) return;
    if (index >= steps.length) {
      pipeline.releaseAll();
      if (onDone) onDone();
      return;
    }
    const step = steps[index];
    index += 1;
    apply(step);
    const following = steps[index];
    const delay = following ? Math.max(0, following.at - step.at) : 0;
    schedule(next, delay - startAt);
  }

  schedule(next, steps.length ? steps[0].at : 0);
  return { cancel: () => (cancelled = true) };
}
