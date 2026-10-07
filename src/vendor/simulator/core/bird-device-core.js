// Bird device role — impersonates a physical Bird panel against bird-ai-server
// so the dashboard's pairing flow (Room ID + PIN) completes against the
// simulator.
//
// Lifecycle: encrypt a hardwareId → generate-code (creates the device, returns
// the Room ID) → open the device socket (presence, which pairing requires) →
// surface the 2FA PIN when the dashboard requests it → on PAIR_DEVICE, emit
// PAIR_SUCCESSFUL so the dashboard's /user-events socket sees the pairing.

import { io as socketIoClient } from 'socket.io-client';
import { BIRD_EVENTS, DEFAULT_DEVICE_NAME } from './constants';
import { encryptHardwareId } from './device-crypto';

/**
 * Extracts the user room id from a PAIR_DEVICE payload. The dashboard's
 * /user-events socket joins room = the token `sub` (== userId for anonymous),
 * so PAIR_SUCCESSFUL must be forwarded to that same id.
 * @param {object} user - the user object from the PAIR_DEVICE payload
 * @returns {string} the user room id
 */
function userRoomId(user) {
  if (!user || typeof user !== 'object') return '';
  return user.userId || user.sub || user.id || '';
}

/**
 * Creates a Bird device simulator bound to bird-ai-server.
 * @param {object} options - configuration
 * @param {string} options.birdUrl - bird-ai-server base URL
 * @param {string} options.hardwareId - the device hardware id to register
 * @param {string} [options.deviceName] - human-readable device name shown in the dashboard
 * @param {function(string): Promise<string>} [options.encrypt] - hardwareId encryptor (injectable)
 * @param {function} [options.socketFactory] - socket.io client factory (injectable)
 * @param {function} [options.fetchFn] - fetch implementation (injectable)
 * @param {object} [options.callbacks] - onStatus, onDeviceCode, onPairingPin, onPaired,
 *   onUnpaired, onScreenshare, onError, onRemoteControl(payload) for REMOTE_CONTROL
 *   events relayed by bird-ai-server (the socket input path)
 * @returns {object} device API: goLive(), stop(), getDeviceCode(), isOnline()
 */
export function createBirdDevice({
  birdUrl,
  hardwareId,
  deviceName = DEFAULT_DEVICE_NAME,
  encrypt = encryptHardwareId,
  socketFactory = socketIoClient,
  fetchFn,
  callbacks,
}) {
  const noop = () => {};
  const cb = {
    onStatus: noop,
    onDeviceCode: noop,
    onPairingPin: noop,
    onPaired: noop,
    onUnpaired: noop,
    onScreenshare: noop,
    onError: noop,
    onRemoteControl: noop,
    ...(callbacks || {}),
  };
  const doFetch =
    fetchFn ||
    ((...args) =>
      typeof fetch !== 'undefined' ? fetch(...args) : Promise.reject(new Error('no fetch')));

  const base = String(birdUrl || '').replace(/\/+$/, '');
  let socket = null;
  let deviceCode = '';
  let online = false;
  let encryptedHardwareIdCache = '';

  /**
   * Registers the device and returns its Room ID (deviceCode).
   * @param {string} encryptedHardwareId - the encrypted hardware id
   * @returns {Promise<string>} the deviceCode
   */
  async function generateCode(encryptedHardwareId) {
    const response = await doFetch(`${base}/registered-devices/generate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptedHardwareId }),
    });
    if (!response.ok) {
      throw new Error(`generate-code failed (${response.status})`);
    }
    const payload = await response.json();
    const code = payload && payload.data && payload.data.deviceCode;
    if (!code) throw new Error('generate-code returned no deviceCode');
    return code;
  }

  function wireSocket(activeSocket) {
    activeSocket.on('connect', () => {
      online = true;
      cb.onStatus('online');
    });
    activeSocket.on('disconnect', () => {
      online = false;
      cb.onStatus('offline');
    });
    activeSocket.on('connect_error', (error) => {
      cb.onError(error);
    });

    activeSocket.on(BIRD_EVENTS.TWO_FACTOR_AUTH_PIN, (payload) => {
      const pin = payload && payload.pin;
      if (pin) cb.onPairingPin(String(pin));
    });

    activeSocket.on(BIRD_EVENTS.PAIR_DEVICE, (payload) => {
      const data = (payload && payload.data) || {};
      const userId = userRoomId(data.user);
      // The dashboard only learns of the pairing when the device echoes
      // PAIR_SUCCESSFUL (server forwards it to the user's /user-events room).
      activeSocket.emit(
        BIRD_EVENTS.PAIR_SUCCESSFUL,
        JSON.stringify({ userId, deviceName, deviceCode: data.deviceCode || deviceCode }),
      );
      cb.onPaired({ deviceCode: data.deviceCode || deviceCode, deviceName, user: data.user });
    });

    activeSocket.on(BIRD_EVENTS.UNPAIR_DEVICE, () => {
      cb.onUnpaired();
    });

    activeSocket.on(BIRD_EVENTS.SCREENSHARE_STARTED, (payload) => {
      cb.onScreenshare('started', payload);
    });
    activeSocket.on(BIRD_EVENTS.SCREENSHARE_STOPPED, (payload) => {
      cb.onScreenshare('stopped', payload);
    });

    activeSocket.on(BIRD_EVENTS.REMOTE_CONTROL, (payload) => {
      cb.onRemoteControl(payload);
    });
  }

  /**
   * Brings the device online: register + connect. Idempotent-safe to call once.
   * @returns {Promise<string>} the deviceCode the dashboard should pair with
   */
  /**
   * Fetches a per-device Cymcast receiver token (v3 panel auth). The panel
   * presents this token to cymcast in panel-register {token} instead of the
   * shared device_secret. Requires goLive() to have run (device registered).
   * @returns {Promise<string>} the signed receiver token
   * @throws {Error} when the device is not live or the request fails
   */
  async function fetchCymcastReceiverToken() {
    if (!encryptedHardwareIdCache) {
      throw new Error('device not live — call goLive() first');
    }
    const response = await doFetch(`${base}/device/cymcast-receiver-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptedHardwareId: encryptedHardwareIdCache }),
    });
    if (!response.ok) {
      throw new Error(`cymcast-receiver-token failed (${response.status})`);
    }
    const payload = await response.json();
    const token = payload && payload.token;
    if (!token) throw new Error('cymcast-receiver-token returned no token');
    return token;
  }

  async function goLive() {
    cb.onStatus('connecting');
    const encryptedHardwareId = await encrypt(hardwareId);
    encryptedHardwareIdCache = encryptedHardwareId;
    deviceCode = await generateCode(encryptedHardwareId);
    cb.onDeviceCode(deviceCode, hardwareId);

    socket = socketFactory(base, {
      transports: ['websocket'],
      query: { encryptedHardwareId },
      reconnection: true,
    });
    wireSocket(socket);
    return deviceCode;
  }

  /**
   * Reports the Cymcast room code this device was assigned when it registered
   * with the Cymcast service (panelId = hardwareId). bird-ai-server stores it
   * against the device's authenticated hardwareId so the dashboard can resolve
   * it after pairing. No-op if the socket is not connected.
   * @param {string} cymcastRoomCode - the Cymcast-assigned room code
   * @returns {void}
   */
  function reportCymcastRoomCode(cymcastRoomCode) {
    if (!socket || !cymcastRoomCode) return;
    socket.emit(BIRD_EVENTS.CYMCAST_ROOM_CODE, JSON.stringify({ cymcastRoomCode }));
  }

  /**
   * Sends a MEETING_COMMAND to bird-ai-server, which relays it as a `message`
   * of type MEETING_COMMAND to the paired user's room. The POC uses it for
   * socket-path acks and probe replies (the panel has no other reply channel).
   * @param {object} payload - must include the paired `userId`
   * @returns {boolean} false when the device socket is not up
   */
  function sendMeetingCommand(payload) {
    if (!socket) return false;
    socket.emit(BIRD_EVENTS.MEETING_COMMAND, JSON.stringify(payload));
    return true;
  }

  function stop() {
    if (socket) {
      try {
        socket.disconnect();
      } catch (_) {
        /* already closed */
      }
      socket = null;
    }
    online = false;
    encryptedHardwareIdCache = '';
  }

  return {
    goLive,
    stop,
    sendMeetingCommand,
    reportCymcastRoomCode,
    fetchCymcastReceiverToken,
    getDeviceCode: () => deviceCode,
    isOnline: () => online,
  };
}
