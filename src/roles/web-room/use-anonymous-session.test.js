import { act, renderHook, waitFor } from '@testing-library/react';
import { decodeSubject, useAnonymousSession } from './use-anonymous-session';

const TOKEN_KEY = 'web-room:anonymousToken';

/**
 * Fake socket.io client instance.
 * @returns {object} the fake socket
 */
function fakeSocket() {
  const handlers = {};
  return {
    handlers,
    connected: false,
    on: vi.fn((event, fn) => {
      handlers[event] = fn;
    }),
    off: vi.fn(),
    disconnect: vi.fn(),
  };
}

/**
 * Builds a JWT-shaped string with the given payload (unsigned, display only).
 * @param {object} payload - claims
 * @returns {string} the token
 */
function fakeJwt(payload) {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=/g, '');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

/**
 * Renders the hook with injected fetch and socket factory.
 * @param {object} [options] - overrides
 * @returns {object} the harness
 */
function createHarness({ loginToken = fakeJwt({ sub: 'user-1' }) } = {}) {
  const sockets = [];
  const socketFactory = vi.fn((url, opts) => {
    const socket = fakeSocket();
    socket.url = url;
    socket.opts = opts;
    sockets.push(socket);
    return socket;
  });
  const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { token: loginToken } }) }));
  const hook = renderHook(() => useAnonymousSession({ birdUrl: 'https://bird.test', fetchFn, socketFactory }));
  return { hook, sockets, socketFactory, fetchFn, loginToken };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('decodeSubject', () => {
  test('decodeSubject_withSubClaim_returnsIt', () => {
    expect(decodeSubject(fakeJwt({ sub: 'abc' }))).toBe('abc');
  });

  test('decodeSubject_withGarbage_returnsEmpty', () => {
    expect(decodeSubject('nope')).toBe('');
  });
});

describe('useAnonymousSession', () => {
  test('mount_withoutStoredToken_logsInAndOpensUserEventsSocket', async () => {
    const { hook, sockets, socketFactory, loginToken } = createHarness();

    await waitFor(() => expect(sockets).toHaveLength(1));

    expect(socketFactory.mock.calls[0][0]).toBe('https://bird.test');
    expect(sockets[0].opts.path).toBe('/user-events');
    expect(sockets[0].opts.transports).toEqual(['websocket']);
    const authCb = vi.fn();
    sockets[0].opts.auth(authCb);
    expect(authCb).toHaveBeenCalledWith({ token: loginToken });
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBe(loginToken);
    expect(hook.result.current.userId).toBe('user-1');
  });

  test('mount_withStoredToken_skipsLogin', async () => {
    window.sessionStorage.setItem(TOKEN_KEY, fakeJwt({ sub: 'stored' }));

    const { sockets, fetchFn } = createHarness();

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('connect_setsStatusConnected_andMessagesReachSubscribers', async () => {
    const { hook, sockets } = createHarness();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const seen = [];
    hook.result.current.subscribe((e) => seen.push(e));

    act(() => sockets[0].handlers.connect());
    act(() => sockets[0].handlers.message({ type: 'PAIR_SUCCESSFUL' }));

    expect(hook.result.current.status).toBe('connected');
    expect(seen).toEqual([{ event: 'message', payload: { type: 'PAIR_SUCCESSFUL' } }]);
  });

  test('connectError_forbidden_dropsTokenAndLogsInAgain', async () => {
    const { sockets, fetchFn } = createHarness();
    await waitFor(() => expect(sockets).toHaveLength(1));

    act(() => sockets[0].handlers.connect_error(new Error('FORBIDDEN')));

    await waitFor(() => expect(sockets).toHaveLength(2));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sockets[0].disconnect).toHaveBeenCalled();
  });

  test('unmount_removesListenersAndDisconnects', async () => {
    const { hook, sockets } = createHarness();
    await waitFor(() => expect(sockets).toHaveLength(1));

    hook.unmount();

    expect(sockets[0].off).toHaveBeenCalled();
    expect(sockets[0].disconnect).toHaveBeenCalled();
  });
});
