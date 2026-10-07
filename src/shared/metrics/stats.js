// Small statistics helpers for the metrics panel and the results export.

/**
 * Returns the p-th percentile (nearest-rank) of a sample.
 * @param {number[]} values - samples (unsorted ok)
 * @param {number} p - percentile in 0..100
 * @returns {number} the percentile, or NaN for an empty sample
 */
export function percentile(values, p) {
  if (!values || values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/**
 * Mean of a sample.
 * @param {number[]} values - samples
 * @returns {number} the mean, or NaN for an empty sample
 */
export function mean(values) {
  if (!values || values.length === 0) return NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Jitter as the mean absolute difference between consecutive samples (RFC 3550
 * style inter-arrival variation, without the smoothing filter).
 * @param {number[]} values - consecutive delay samples
 * @returns {number} the jitter, or NaN with fewer than two samples
 */
export function jitter(values) {
  if (!values || values.length < 2) return NaN;
  let total = 0;
  for (let i = 1; i < values.length; i += 1) total += Math.abs(values[i] - values[i - 1]);
  return total / (values.length - 1);
}

/**
 * Creates a bounded ring of recent samples.
 * @param {number} capacity - maximum samples kept
 * @returns {{push: function(number): void, values: function(): number[], size: function(): number, clear: function(): void}} the ring
 */
export function createSampleRing(capacity) {
  let samples = [];
  return {
    push(value) {
      samples.push(value);
      if (samples.length > capacity) samples = samples.slice(samples.length - capacity);
    },
    values: () => samples.slice(),
    size: () => samples.length,
    clear() {
      samples = [];
    },
  };
}

/**
 * Summarizes a sample for display and export.
 * @param {number[]} values - samples
 * @returns {{count: number, p50: number, p95: number, mean: number, jitter: number}} the summary
 */
export function summarize(values) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    mean: mean(values),
    jitter: jitter(values),
  };
}
