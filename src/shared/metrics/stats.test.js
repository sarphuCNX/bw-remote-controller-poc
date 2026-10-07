import { createSampleRing, jitter, mean, percentile, summarize } from './stats';

describe('percentile', () => {
  test('percentile_p50OfOddSample_returnsMiddleValue', () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });

  test('percentile_p95OfTwentySamples_returnsNineteenthRanked', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);

    expect(percentile(values, 95)).toBe(19);
  });

  test('percentile_ofEmptySample_returnsNaN', () => {
    expect(percentile([], 50)).toBeNaN();
  });
});

describe('mean and jitter', () => {
  test('mean_ofSample_returnsAverage', () => {
    expect(mean([2, 4, 6])).toBe(4);
  });

  test('jitter_ofSteadySample_returnsZero', () => {
    expect(jitter([10, 10, 10])).toBe(0);
  });

  test('jitter_ofVaryingSample_returnsMeanAbsoluteDifference', () => {
    expect(jitter([10, 14, 10])).toBe(4);
  });

  test('jitter_withOneSample_returnsNaN', () => {
    expect(jitter([10])).toBeNaN();
  });
});

describe('createSampleRing', () => {
  test('push_beyondCapacity_keepsOnlyNewest', () => {
    const ring = createSampleRing(3);

    [1, 2, 3, 4].forEach((v) => ring.push(v));

    expect(ring.values()).toEqual([2, 3, 4]);
  });

  test('clear_emptiesTheRing', () => {
    const ring = createSampleRing(3);
    ring.push(1);

    ring.clear();

    expect(ring.size()).toBe(0);
  });
});

describe('summarize', () => {
  test('summarize_returnsCountAndStatistics', () => {
    const summary = summarize([10, 20, 30]);

    expect(summary).toEqual({ count: 3, p50: 20, p95: 30, mean: 20, jitter: 10 });
  });
});
