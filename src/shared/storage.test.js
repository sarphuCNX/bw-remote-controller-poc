import { createTabStorage } from './storage';

/**
 * Minimal Storage-like backend for tests.
 * @returns {{getItem: function, setItem: function, removeItem: function, map: Map}} the backend
 */
function createMemoryBackend() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

describe('createTabStorage', () => {
  test('set_thenGet_returnsValueUnderNamespacedKey', () => {
    const backend = createMemoryBackend();
    const store = createTabStorage('panel', backend);

    store.set('token', 'abc');

    expect(store.get('token')).toBe('abc');
    expect(backend.map.get('panel:token')).toBe('abc');
  });

  test('get_withDifferentNamespace_doesNotSeeOtherRoleValue', () => {
    const backend = createMemoryBackend();
    const panelStore = createTabStorage('panel', backend);
    const webRoomStore = createTabStorage('web-room', backend);

    panelStore.set('token', 'abc');

    expect(webRoomStore.get('token')).toBeNull();
  });

  test('remove_afterSet_getReturnsNull', () => {
    const backend = createMemoryBackend();
    const store = createTabStorage('panel', backend);
    store.set('token', 'abc');

    store.remove('token');

    expect(store.get('token')).toBeNull();
  });

  test('set_whenBackendThrows_doesNotThrow', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createTabStorage('panel', throwing);

    expect(() => store.set('token', 'abc')).not.toThrow();
    expect(store.get('token')).toBeNull();
  });
});
