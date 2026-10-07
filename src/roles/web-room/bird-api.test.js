import { createBirdApi } from './bird-api';

/**
 * Builds a client over a scripted fetch.
 * @param {function} responder - (url, init) => {ok, status, json}
 * @returns {{api: object, calls: Array}} the harness
 */
function createHarness(responder) {
  const calls = [];
  const api = createBirdApi({
    baseUrl: 'https://bird.test/',
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      const res = responder(url, init);
      return { ok: res.ok !== false, status: res.status || 200, json: async () => res.json };
    },
  });
  return { api, calls };
}

describe('createBirdApi', () => {
  test('anonymousLogin_postsUserNameAndReturnsToken', async () => {
    const { api, calls } = createHarness(() => ({ json: { data: { token: 'jwt-1' } } }));

    const token = await api.anonymousLogin();

    expect(token).toBe('jwt-1');
    expect(calls[0].url).toBe('https://bird.test/user/login');
    expect(JSON.parse(calls[0].init.body)).toEqual({ userName: 'SOME_USERNAME' });
  });

  test('anonymousLogin_withoutTokenInPayload_throws', async () => {
    const { api } = createHarness(() => ({ json: { data: {} } }));

    await expect(api.anonymousLogin()).rejects.toThrow(/no token/);
  });

  test('generatePin_sendsBearerAndRoomId', async () => {
    const { api, calls } = createHarness(() => ({ json: { message: 'ok' } }));

    await api.generatePin('jwt-1', 'ABCDE');

    expect(calls[0].url).toBe('https://bird.test/device-2fa/generate-pin');
    expect(calls[0].init.headers.Authorization).toBe('Bearer jwt-1');
    expect(JSON.parse(calls[0].init.body)).toEqual({ roomId: 'ABCDE' });
  });

  test('pairDevice_onServerError_throwsWithMessageAndType', async () => {
    const { api } = createHarness(() => ({
      ok: false,
      status: 422,
      json: { message: 'Invalid PIN', type: 'INVALID_PIN' },
    }));

    await expect(api.pairDevice('jwt-1', { deviceCode: 'ABCDE', pin: '000000' })).rejects.toMatchObject({
      message: 'Invalid PIN',
      status: 422,
      type: 'INVALID_PIN',
    });
  });

  test('castGrant_returnsTokenFromPayload', async () => {
    const { api } = createHarness(() => ({ json: { token: 'grant-1' } }));

    const grant = await api.castGrant('jwt-1');

    expect(grant).toBe('grant-1');
  });

  test('pairStatus_getsWithBearer', async () => {
    const { api, calls } = createHarness(() => ({ json: { message: 'DISCONNECTED' } }));

    const status = await api.pairStatus('jwt-1');

    expect(status.message).toBe('DISCONNECTED');
    expect(calls[0].init.method).toBe('GET');
  });
});
