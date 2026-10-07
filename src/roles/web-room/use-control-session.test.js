import { act, renderHook } from '@testing-library/react';
import { PATH, useControlSession } from './use-control-session';

const { senders } = vi.hoisted(() => ({ senders: [] }));

vi.mock('./control-sender', async () => {
  const actual = await vi.importActual('./control-sender');
  return {
    ...actual,
    createControlSender: vi.fn((options) => {
      const sender = {
        options,
        start: vi.fn(),
        stop: vi.fn(),
        sendControl: vi.fn(() => true),
        getState: () => ({ phase: 'idle' }),
      };
      senders.push(sender);
      return sender;
    }),
  };
});

/**
 * Renders the hook over a fake socket, api and subscription.
 * @returns {object} the harness
 */
function createHarness() {
  const socket = { connected: true, emit: vi.fn() };
  const listeners = new Set();
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const api = { castGrant: vi.fn(async () => 'grant-1') };
  const hook = renderHook(() =>
    useControlSession({ socket, subscribe, api, token: 'jwt', cymcastUrl: 'https://cymcast.test' }),
  );
  return { socket, api, hook, emitSessionEvent: (e) => listeners.forEach((fn) => fn(e)) };
}

beforeEach(() => {
  senders.length = 0;
});

describe('useControlSession start and stop', () => {
  test('start_onDataChannelPath_emitsRemoteStartAndCreatesSender', () => {
    const { hook, socket } = createHarness();

    act(() => hook.result.current.start());

    expect(socket.emit).toHaveBeenCalledWith('REMOTE_CONTROL', { type: 'REMOTE_START' });
    expect(senders).toHaveLength(1);
    expect(senders[0].start).toHaveBeenCalled();
    expect(hook.result.current.open).toBe(true);
  });

  test('start_onSocketPath_activatesSocketPathWithoutSender', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.switchPath(PATH.SOCKET));

    act(() => hook.result.current.start());

    expect(senders).toHaveLength(0);
    expect(hook.result.current.activePath).toBe(PATH.SOCKET);
    expect(hook.result.current.pipeline()).not.toBeNull();
  });

  test('stop_afterStart_emitsRemoteStopAndClosesSender', () => {
    const { hook, socket } = createHarness();
    act(() => hook.result.current.start());

    act(() => hook.result.current.stop());

    expect(socket.emit).toHaveBeenLastCalledWith('REMOTE_CONTROL', { type: 'REMOTE_STOP' });
    expect(senders[0].stop).toHaveBeenCalled();
    expect(hook.result.current.open).toBe(false);
  });

  test('start_whenSocketDisconnected_doesNotOpen', () => {
    const { hook, socket } = createHarness();
    socket.connected = false;

    act(() => hook.result.current.start());

    expect(hook.result.current.open).toBe(false);
    expect(senders).toHaveLength(0);
  });
});

describe('useControlSession fallback and path switching', () => {
  test('channelsOpen_activatesDataChannelPath', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.start());
    const openChannel = { readyState: 'open', send: vi.fn() };

    act(() => senders[0].options.callbacks.onChannels({ pointerChannel: openChannel, controlChannel: openChannel }));

    expect(hook.result.current.activePath).toBe(PATH.DATACHANNEL);
  });

  test('senderClosed_withAnyNonUserReason_fallsBackToSocket', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.start());

    act(() => senders[0].options.callbacks.onClosed('signaling-lost'));

    expect(hook.result.current.activePath).toBe(PATH.SOCKET);
    expect(hook.result.current.log.some((l) => l.includes('fallback after signaling-lost'))).toBe(true);
  });

  test('senderClosed_withPreempted_endsSessionInsteadOfFallingBack', () => {
    const { hook, socket } = createHarness();
    act(() => hook.result.current.start());

    act(() => senders[0].options.callbacks.onClosed('preempted', { terminal: true }));

    expect(hook.result.current.open).toBe(false);
    expect(hook.result.current.activePath).toBe('');
    expect(hook.result.current.endedReason).toBe('preempted');
    expect(socket.emit).toHaveBeenLastCalledWith('REMOTE_CONTROL', { type: 'REMOTE_STOP' });
  });

  test('senderClosed_withBye_endsSessionInsteadOfFallingBack', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.start());

    act(() => senders[0].options.callbacks.onClosed('bye', { terminal: true }));

    expect(hook.result.current.open).toBe(false);
    expect(hook.result.current.endedReason).toBe('bye');
  });

  test('start_afterEndedSession_clearsEndedReason', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.start());
    act(() => senders[0].options.callbacks.onClosed('preempted', { terminal: true }));

    act(() => hook.result.current.start());

    expect(hook.result.current.endedReason).toBe('');
    expect(hook.result.current.open).toBe(true);
  });

  test('senderClosed_withUserStop_doesNotFallBack', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.start());

    act(() => senders[0].options.callbacks.onClosed('stopped', { terminal: true, userStop: true }));

    expect(hook.result.current.activePath).toBe('');
    expect(hook.result.current.endedReason).toBe('');
  });

  test('senderClosed_withTerminalFlagAndUnknownReason_endsSessionWithoutFallback', () => {
    const { hook, socket } = createHarness();
    act(() => hook.result.current.start());

    act(() => senders[0].options.callbacks.onClosed('grant-failed', { terminal: true }));

    expect(hook.result.current.open).toBe(false);
    expect(hook.result.current.activePath).toBe('');
    expect(hook.result.current.endedReason).toBe('grant-failed');
    expect(socket.emit).toHaveBeenLastCalledWith('REMOTE_CONTROL', { type: 'REMOTE_STOP' });
  });

  test('senderClosed_withoutInfo_isTreatedAsNonTerminalAndFallsBack', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.start());

    act(() => senders[0].options.callbacks.onClosed('failed'));

    expect(hook.result.current.open).toBe(true);
    expect(hook.result.current.activePath).toBe(PATH.SOCKET);
  });

  test('senderClosed_terminalOnFirstRender_stillStopsViaStopRef', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.start());
    const sender = senders[0];
    act(() => hook.result.current.stop());
    act(() => hook.result.current.start());

    act(() => sender.options.callbacks.onClosed('bye', { terminal: true }));

    expect(hook.result.current.open).toBe(false);
  });

  test('switchPath_toDataChannelAfterFallback_createsNewSender', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.start());
    act(() => senders[0].options.callbacks.onClosed('open-timeout'));

    act(() => hook.result.current.switchPath(PATH.DATACHANNEL));

    expect(senders).toHaveLength(2);
    expect(senders[1].start).toHaveBeenCalled();
  });

  test('switchPath_toSocketWhileOpen_stopsSenderAndUsesSocket', () => {
    const { hook } = createHarness();
    act(() => hook.result.current.start());

    act(() => hook.result.current.switchPath(PATH.SOCKET));

    expect(senders[0].stop).toHaveBeenCalled();
    expect(hook.result.current.activePath).toBe(PATH.SOCKET);
  });
});

describe('useControlSession socket-path replies', () => {
  test('meetingCommandProbeAck_feedsTheProbe', () => {
    const { hook, emitSessionEvent } = createHarness();
    act(() => hook.result.current.switchPath(PATH.SOCKET));
    act(() => hook.result.current.start());

    expect(() =>
      act(() =>
        emitSessionEvent({
          event: 'message',
          payload: { type: 'MEETING_COMMAND', kind: 'probe-ack', id: 1, ts: 0, panelTs: 5 },
        }),
      ),
    ).not.toThrow();
  });
});
