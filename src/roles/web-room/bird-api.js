// bird-ai-server HTTP client for the web room — the same endpoints and bodies
// birdai-web uses (services/device.service.js, Utils/url-builder.js), without
// axios, Redux or localStorage.

/**
 * Creates the API client.
 * @param {object} options - configuration
 * @param {string} options.baseUrl - bird-ai-server base URL
 * @param {function} [options.fetchFn] - fetch implementation (injectable)
 * @returns {object} the client
 */
export function createBirdApi({ baseUrl, fetchFn }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const doFetch = fetchFn || ((...args) => fetch(...args));

  async function request(path, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await doFetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }
    if (!response.ok) {
      const error = new Error((payload && payload.message) || `${method} ${path} failed (${response.status})`);
      error.status = response.status;
      error.type = payload && payload.type;
      throw error;
    }
    return payload;
  }

  return {
    /**
     * Mints an anonymous user token (what the landing page does).
     * @returns {Promise<string>} the JWT
     */
    async anonymousLogin() {
      const payload = await request('/user/login', {
        method: 'POST',
        body: { userName: 'SOME_USERNAME' },
      });
      const token = payload && payload.data && payload.data.token;
      if (!token) throw new Error('login returned no token');
      return token;
    },
    /**
     * Asks the panel to display a pairing PIN.
     * @param {string} token - caller JWT
     * @param {string} roomId - the Room ID (deviceCode)
     * @returns {Promise<object>} the server payload
     */
    generatePin(token, roomId) {
      return request('/device-2fa/generate-pin', { method: 'POST', token, body: { roomId } });
    },
    /**
     * Pairs the caller with the panel.
     * @param {string} token - caller JWT
     * @param {{deviceCode: string, pin: string}} body - pairing body
     * @returns {Promise<{message: string, hardwareId: string}>} the result
     */
    pairDevice(token, body) {
      return request('/device/pairDevice', { method: 'POST', token, body });
    },
    /**
     * Current pairing status of the caller.
     * @param {string} token - caller JWT
     * @returns {Promise<{message: 'CONNECTED'|'DISCONNECTED', data?: object}>} the status
     */
    pairStatus(token) {
      return request('/device/getPairDeviceStatus', { token });
    },
    /**
     * Unpairs the caller.
     * @param {string} token - caller JWT
     * @returns {Promise<object>} the server payload
     */
    unpair(token) {
      return request('/device/unpairDevice', { method: 'POST', token, body: {} });
    },
    /**
     * Mints the cymcast cast grant for the caller's paired panel.
     * @param {string} token - caller JWT
     * @returns {Promise<string>} the grant JWT
     */
    async castGrant(token) {
      const payload = await request('/device/cymcast-sender-token', {
        method: 'POST',
        token,
        body: {},
      });
      const grant = payload && payload.token;
      if (!grant) throw new Error('cymcast-sender-token returned no token');
      return grant;
    },
  };
}
