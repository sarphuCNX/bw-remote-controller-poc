// Tests for the Bird device core with a fake socket.io client + fake fetch.

import { createBirdDevice } from '../core/bird-device-core';
import { BIRD_EVENTS } from '../core/constants';

/** A fake socket.io client capturing handlers and emitted messages. */
class FakeSocket {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.handlers = {};
    this.emitted = [];
    this.disconnected = false;
  }
  on(event, fn) {
    (this.handlers[event] = this.handlers[event] || []).push(fn);
  }
  emit(event, payload) {
    this.emitted.push({ event, payload });
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(event, payload) {
    (this.handlers[event] || []).forEach((fn) => fn(payload));
  }
}

const createDeps = (overrides = {}) => {
  let lastSocket = null;
  const socketFactory = vi.fn((url, opts) => {
    lastSocket = new FakeSocket(url, opts);
    return lastSocket;
  });
  const fetchFn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { hardwareId: 'sim-hw-1', deviceCode: 'ABC12' } }),
  });
  const callbacks = {
    onStatus: vi.fn(),
    onDeviceCode: vi.fn(),
    onPairingPin: vi.fn(),
    onPaired: vi.fn(),
    onUnpaired: vi.fn(),
    onScreenshare: vi.fn(),
    onError: vi.fn(),
  };
  const device = createBirdDevice({
    birdUrl: 'https://bird.test/',
    hardwareId: 'sim-hw-1',
    deviceName: 'Sim Room',
    encrypt: vi.fn().mockResolvedValue('ENC_HW'),
    socketFactory,
    fetchFn,
    callbacks,
    ...overrides,
  });
  return { device, socketFactory, fetchFn, callbacks, getSocket: () => lastSocket };
};

describe('createBirdDevice goLive', () => {
  test('posts generate-code with the encrypted hardware id and no trailing slash duplication', async () => {
    const { device, fetchFn } = createDeps();

    await device.goLive();

    expect(fetchFn).toHaveBeenCalledWith(
      'https://bird.test/registered-devices/generate-code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ encryptedHardwareId: 'ENC_HW' }),
      }),
    );
  });

  test('returns the deviceCode from generate-code and surfaces it', async () => {
    const { device, callbacks } = createDeps();

    const code = await device.goLive();

    expect(code).toBe('ABC12');
    expect(callbacks.onDeviceCode).toHaveBeenCalledWith('ABC12', 'sim-hw-1');
  });

  test('opens the socket with the encrypted hardware id in the query', async () => {
    const { device, getSocket } = createDeps();

    await device.goLive();

    expect(getSocket().opts.query).toEqual({ encryptedHardwareId: 'ENC_HW' });
  });

  test('a failed generate-code response rejects', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { device } = createDeps({ fetchFn });

    await expect(device.goLive()).rejects.toThrow('generate-code failed (500)');
  });
});

describe('createBirdDevice pairing', () => {
  test('a connect event reports the device online', async () => {
    const { device, callbacks, getSocket } = createDeps();
    await device.goLive();

    getSocket().fire('connect');

    expect(callbacks.onStatus).toHaveBeenCalledWith('online');
    expect(device.isOnline()).toBe(true);
  });

  test('TWO_FACTOR_AUTH_PIN surfaces the pairing PIN', async () => {
    const { device, callbacks, getSocket } = createDeps();
    await device.goLive();

    getSocket().fire(BIRD_EVENTS.TWO_FACTOR_AUTH_PIN, { pin: '123456' });

    expect(callbacks.onPairingPin).toHaveBeenCalledWith('123456');
  });

  test('PAIR_DEVICE emits PAIR_SUCCESSFUL as a JSON string with the user room id', async () => {
    const { device, getSocket } = createDeps();
    await device.goLive();

    getSocket().fire(BIRD_EVENTS.PAIR_DEVICE, {
      data: { deviceCode: 'ABC12', user: { userId: 'user-9', id: 'user-9' } },
    });

    const pairSuccessful = getSocket().emitted.find((m) => m.event === BIRD_EVENTS.PAIR_SUCCESSFUL);
    expect(JSON.parse(pairSuccessful.payload)).toEqual({
      userId: 'user-9',
      deviceName: 'Sim Room',
      deviceCode: 'ABC12',
    });
  });

  test('PAIR_DEVICE reports the pairing to the caller', async () => {
    const { device, callbacks, getSocket } = createDeps();
    await device.goLive();

    getSocket().fire(BIRD_EVENTS.PAIR_DEVICE, {
      data: { deviceCode: 'ABC12', user: { userId: 'user-9' } },
    });

    expect(callbacks.onPaired).toHaveBeenCalledWith(
      expect.objectContaining({ deviceCode: 'ABC12', deviceName: 'Sim Room' }),
    );
  });

  test('UNPAIR_DEVICE reports an unpair', async () => {
    const { device, callbacks, getSocket } = createDeps();
    await device.goLive();

    getSocket().fire(BIRD_EVENTS.UNPAIR_DEVICE, { data: { deviceCode: 'ABC12' } });

    expect(callbacks.onUnpaired).toHaveBeenCalled();
  });

  test('SCREENSHARE_STARTED reports a screenshare event', async () => {
    const { device, callbacks, getSocket } = createDeps();
    await device.goLive();

    getSocket().fire(BIRD_EVENTS.SCREENSHARE_STARTED, {
      type: 'SCREENSHARE_STARTED',
      roomId: 'r1',
    });

    expect(callbacks.onScreenshare).toHaveBeenCalledWith(
      'started',
      expect.objectContaining({ roomId: 'r1' }),
    );
  });
});

describe('createBirdDevice reportCymcastRoomCode', () => {
  test('emits CYMCAST_ROOM_CODE as a JSON string with the reported code', async () => {
    const { device, getSocket } = createDeps();
    await device.goLive();

    device.reportCymcastRoomCode('XYZ99');

    const reported = getSocket().emitted.find(
      (m) => m.event === BIRD_EVENTS.CYMCAST_ROOM_CODE,
    );
    expect(JSON.parse(reported.payload)).toEqual({ cymcastRoomCode: 'XYZ99' });
  });

  test('does not emit when the code is empty', async () => {
    const { device, getSocket } = createDeps();
    await device.goLive();

    device.reportCymcastRoomCode('');

    const reported = getSocket().emitted.find(
      (m) => m.event === BIRD_EVENTS.CYMCAST_ROOM_CODE,
    );
    expect(reported).toBeUndefined();
  });

  test('does not throw when the socket is not connected', () => {
    const { device } = createDeps();

    expect(() => device.reportCymcastRoomCode('XYZ99')).not.toThrow();
  });
});

describe('createBirdDevice stop', () => {
  test('stop disconnects the socket', async () => {
    const { device, getSocket } = createDeps();
    await device.goLive();

    device.stop();

    expect(getSocket().disconnected).toBe(true);
  });
});
