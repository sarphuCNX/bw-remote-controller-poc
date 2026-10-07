import { defaultConfig, readConfig, saveConfig, isConfigReady } from '../core/simulator-config';
import { DEVICE_SIMULATOR_STORAGE_KEY } from '../core/constants';

/**
 * Creates an in-memory localStorage-like fake.
 * @param {object} [initial] - initial key/value pairs
 * @returns {{getItem: function, setItem: function, data: object}} fake storage
 */
const createFakeStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};

describe('defaultConfig', () => {
  test('seeds a hardware id with the sim- prefix', () => {
    const defaults = defaultConfig();

    expect(defaults.hardwareId).toMatch(/^sim-/);
  });

  test('defaults the simulator version to v1', () => {
    const defaults = defaultConfig();

    expect(defaults.version).toBe('v1');
  });

  test('seeds bird and cymcast urls from the dashboard config', () => {
    const defaults = defaultConfig();

    expect(typeof defaults.birdUrl).toBe('string');
    expect(typeof defaults.cymcastUrl).toBe('string');
  });
});

describe('readConfig', () => {
  test('empty storage returns defaults and persists a generated hardware id', () => {
    const storage = createFakeStorage();

    const result = readConfig(storage);

    expect(JSON.parse(storage.data[DEVICE_SIMULATOR_STORAGE_KEY]).hardwareId).toBe(
      result.hardwareId,
    );
  });

  test('a persisted hardware id is reused rather than regenerated', () => {
    const storage = createFakeStorage({
      [DEVICE_SIMULATOR_STORAGE_KEY]: JSON.stringify({ hardwareId: 'sim-persisted-1' }),
    });

    const result = readConfig(storage);

    expect(result.hardwareId).toBe('sim-persisted-1');
  });

  test('corrupt stored JSON falls back to defaults', () => {
    const storage = createFakeStorage({ [DEVICE_SIMULATOR_STORAGE_KEY]: '{broken' });

    const result = readConfig(storage);

    expect(result.hardwareId).toMatch(/^sim-/);
  });

  test('a persisted known version is honored', () => {
    const storage = createFakeStorage({
      [DEVICE_SIMULATOR_STORAGE_KEY]: JSON.stringify({ hardwareId: 'sim-1', version: 'v2' }),
    });

    expect(readConfig(storage).version).toBe('v2');
  });

  test('an unknown persisted version falls back to the default', () => {
    const storage = createFakeStorage({
      [DEVICE_SIMULATOR_STORAGE_KEY]: JSON.stringify({ hardwareId: 'sim-1', version: 'v999' }),
    });

    expect(readConfig(storage).version).toBe('v1');
  });

  test('persisted urls and secret override the defaults', () => {
    const storage = createFakeStorage({
      [DEVICE_SIMULATOR_STORAGE_KEY]: JSON.stringify({
        birdUrl: 'http://localhost:7771',
        cymcastUrl: 'http://localhost:8787',
        panelSecret: 'dev',
        hardwareId: 'sim-1',
      }),
    });

    const result = readConfig(storage);

    expect(result).toMatchObject({
      birdUrl: 'http://localhost:7771',
      cymcastUrl: 'http://localhost:8787',
      panelSecret: 'dev',
    });
  });
});

describe('saveConfig', () => {
  test('persists the config under the simulator storage key', () => {
    const storage = createFakeStorage();
    const next = {
      birdUrl: 'http://localhost:7771',
      cymcastUrl: 'http://localhost:8787',
      panelSecret: 'dev',
      hardwareId: 'sim-1',
      deviceName: 'Room',
    };

    saveConfig(next, storage);

    expect(JSON.parse(storage.data[DEVICE_SIMULATOR_STORAGE_KEY])).toEqual(next);
  });

  test('a throwing storage is swallowed', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };

    expect(() => saveConfig({ hardwareId: 'sim-1' }, storage)).not.toThrow();
  });
});

describe('isConfigReady', () => {
  test('is true when all required fields are present', () => {
    const ready = isConfigReady({
      birdUrl: 'http://localhost:7771',
      cymcastUrl: 'http://localhost:8787',
      panelSecret: 'dev',
      hardwareId: 'sim-1',
    });

    expect(ready).toBe(true);
  });

  test('is false when the panel secret is missing', () => {
    const ready = isConfigReady({
      birdUrl: 'http://localhost:7771',
      cymcastUrl: 'http://localhost:8787',
      panelSecret: '',
      hardwareId: 'sim-1',
    });

    expect(ready).toBe(false);
  });
});
