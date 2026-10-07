import { createLatencyProbe } from './latency-probe';

/**
 * Builds a probe with a manual clock and captured sends.
 * @returns {{probe: object, sent: object[], tick: function(number): void}} the harness
 */
function createHarness() {
  let time = 1000;
  const sent = [];
  const probe = createLatencyProbe({
    send: (message) => {
      sent.push(message);
      return true;
    },
    now: () => time,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  return { probe, sent, tick: (ms) => (time += ms) };
}

describe('createLatencyProbe', () => {
  test('sendOnce_sendsProbeWithIdAndTimestamp', () => {
    const { probe, sent } = createHarness();

    probe.sendOnce();

    expect(sent).toEqual([{ t: 'probe', id: 1, ts: 1000 }]);
  });

  test('onMessage_withMatchingProbeAck_recordsRttAndClockOffset', () => {
    const { probe, tick } = createHarness();
    probe.sendOnce();
    tick(40);

    const consumed = probe.onMessage({ t: 'probe-ack', id: 1, ts: 1000, panelTs: 5020 });

    expect(consumed).toBe(true);
    expect(probe.rttSamples()).toEqual([40]);
    expect(probe.clockOffsetMs()).toBe(5020 - 1020);
  });

  test('onMessage_withUnknownProbeId_isConsumedButNotRecorded', () => {
    const { probe } = createHarness();

    const consumed = probe.onMessage({ t: 'probe-ack', id: 99, ts: 0, panelTs: 0 });

    expect(consumed).toBe(true);
    expect(probe.rttSamples()).toEqual([]);
  });

  test('onMessage_withNonProbeMessage_returnsFalse', () => {
    const { probe } = createHarness();

    expect(probe.onMessage({ t: 'ack', seq: 1 })).toBe(false);
  });

  test('sendOnce_whenSendFails_doesNotTrackInFlight', () => {
    let time = 0;
    const probe = createLatencyProbe({ send: () => false, now: () => time });
    probe.sendOnce();
    time = 10;

    probe.onMessage({ t: 'probe-ack', id: 1, ts: 0, panelTs: 0 });

    expect(probe.rttSamples()).toEqual([]);
  });
});
