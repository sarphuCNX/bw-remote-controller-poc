import { act, renderHook, waitFor } from '@testing-library/react';
import { PAIRING_STEP, usePairing } from './use-pairing';

/**
 * Renders the pairing hook over a fake api and a manual session emitter.
 * @param {object} [apiOverrides] - api method overrides
 * @param {string} [socketStatus] - initial socket status
 * @returns {object} the harness
 */
function createHarness(apiOverrides = {}, socketStatus = 'connecting') {
  const listeners = new Set();
  const api = {
    generatePin: vi.fn(async () => ({})),
    pairDevice: vi.fn(async () => ({ hardwareId: 'hw-1' })),
    pairStatus: vi.fn(async () => ({ message: 'DISCONNECTED' })),
    unpair: vi.fn(async () => ({})),
    ...apiOverrides,
  };
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const hook = renderHook((props) => usePairing({ api, token: 'jwt', subscribe, socketStatus: props.socketStatus }), {
    initialProps: { socketStatus },
  });
  return { api, hook, emit: (payload) => listeners.forEach((fn) => fn({ event: 'message', payload })) };
}

describe('usePairing steps', () => {
  test('requestPin_withRoomId_uppercasesAndMovesToPinStep', async () => {
    const { api, hook } = createHarness();
    act(() => hook.result.current.setRoomId('abcde'));

    await act(() => hook.result.current.requestPin());

    expect(api.generatePin).toHaveBeenCalledWith('jwt', 'ABCDE');
    expect(hook.result.current.step).toBe(PAIRING_STEP.PIN);
    expect(hook.result.current.roomId).toBe('ABCDE');
  });

  test('requestPin_withoutRoomId_showsMessageAndStays', async () => {
    const { api, hook } = createHarness();

    await act(() => hook.result.current.requestPin());

    expect(api.generatePin).not.toHaveBeenCalled();
    expect(hook.result.current.message).toBe('enter the Room ID');
  });

  test('pair_onServerError_returnsToPinStepWithMessage', async () => {
    const { hook } = createHarness({ pairDevice: vi.fn(async () => { throw new Error('Invalid PIN'); }) });
    act(() => hook.result.current.setRoomId('ABCDE'));
    await act(() => hook.result.current.requestPin());
    act(() => hook.result.current.setPin('000000'));

    await act(() => hook.result.current.pair());

    expect(hook.result.current.step).toBe(PAIRING_STEP.PIN);
    expect(hook.result.current.message).toBe('Invalid PIN');
  });

  test('pairSuccessfulMessage_setsPairedWithDeviceName', () => {
    const { hook, emit } = createHarness();

    act(() => emit({ type: 'PAIR_SUCCESSFUL', deviceName: 'Room A' }));

    expect(hook.result.current.isPaired).toBe(true);
    expect(hook.result.current.deviceName).toBe('Room A');
  });

  test('unpairDeviceMessage_resetsToRoomIdStep', () => {
    const { hook, emit } = createHarness();
    act(() => emit({ type: 'PAIR_SUCCESSFUL' }));

    act(() => emit({ type: 'UNPAIR_DEVICE' }));

    expect(hook.result.current.step).toBe(PAIRING_STEP.ROOM_ID);
  });
});

describe('usePairing status check on connect', () => {
  test('statusConnected_onSocketConnect_promotesToPaired', async () => {
    const { hook } = createHarness({
      pairStatus: vi.fn(async () => ({ message: 'CONNECTED', data: { hardwareId: 'hw-1', deviceCode: 'ABCDE', deviceName: 'Room A' } })),
    });

    hook.rerender({ socketStatus: 'connected' });

    await waitFor(() => expect(hook.result.current.isPaired).toBe(true));
    expect(hook.result.current.roomId).toBe('ABCDE');
  });

  test('statusDisconnected_whilePaired_resetsToRoomIdStep', async () => {
    const { hook, emit } = createHarness();
    act(() => emit({ type: 'PAIR_SUCCESSFUL' }));

    hook.rerender({ socketStatus: 'connected' });

    await waitFor(() => expect(hook.result.current.step).toBe(PAIRING_STEP.ROOM_ID));
    expect(hook.result.current.message).toBe('pairing ended while offline');
  });

  test('staleDisconnectedStatus_afterPairSuccessful_isIgnored', async () => {
    let resolveStatus;
    const { hook, emit, api } = createHarness({
      pairStatus: vi.fn(() => new Promise((resolve) => (resolveStatus = resolve))),
    });
    hook.rerender({ socketStatus: 'connected' });
    await waitFor(() => expect(api.pairStatus).toHaveBeenCalled());
    act(() => emit({ type: 'PAIR_SUCCESSFUL', deviceName: 'Room A' }));

    await act(async () => {
      resolveStatus({ message: 'DISCONNECTED' });
    });

    expect(hook.result.current.isPaired).toBe(true);
  });

  test('staleConnectedStatus_afterUnpairDevice_isIgnored', async () => {
    let resolveStatus;
    const { hook, emit, api } = createHarness({
      pairStatus: vi.fn(() => new Promise((resolve) => (resolveStatus = resolve))),
    });
    hook.rerender({ socketStatus: 'connected' });
    await waitFor(() => expect(api.pairStatus).toHaveBeenCalled());
    act(() => emit({ type: 'UNPAIR_DEVICE' }));

    await act(async () => {
      resolveStatus({ message: 'CONNECTED', data: { hardwareId: 'hw', deviceCode: 'ROOM', deviceName: 'Room A' } });
    });

    expect(hook.result.current.isPaired).toBe(false);
  });

  test('statusResponse_afterUnrelatedSocketMessage_isStillApplied', async () => {
    let resolveStatus;
    const { hook, emit, api } = createHarness({
      pairStatus: vi.fn(() => new Promise((resolve) => (resolveStatus = resolve))),
    });
    hook.rerender({ socketStatus: 'connected' });
    await waitFor(() => expect(api.pairStatus).toHaveBeenCalled());
    act(() => emit({ type: 'MEETING_COMMAND', kind: 'ack', seq: 1 }));

    await act(async () => {
      resolveStatus({ message: 'CONNECTED', data: { hardwareId: 'hw', deviceCode: 'ROOM', deviceName: 'Room A' } });
    });

    expect(hook.result.current.isPaired).toBe(true);
  });

  test('statusResponse_afterUnmount_doesNotThrow', async () => {
    let resolveStatus;
    const { hook, api } = createHarness({
      pairStatus: vi.fn(() => new Promise((resolve) => (resolveStatus = resolve))),
    });
    hook.rerender({ socketStatus: 'connected' });
    await waitFor(() => expect(api.pairStatus).toHaveBeenCalled());
    hook.unmount();

    await expect(
      (async () => {
        resolveStatus({ message: 'CONNECTED', data: {} });
        await new Promise((resolve) => setTimeout(resolve, 0));
      })(),
    ).resolves.toBeUndefined();
  });

  test('statusDisconnected_duringPinEntry_doesNotDisturbTheStep', async () => {
    const { api, hook } = createHarness();
    act(() => hook.result.current.setRoomId('ABCDE'));
    await act(() => hook.result.current.requestPin());

    hook.rerender({ socketStatus: 'connected' });

    await waitFor(() => expect(api.pairStatus).toHaveBeenCalled());
    expect(hook.result.current.step).toBe(PAIRING_STEP.PIN);
  });
});
