// Per-tab storage. Two tabs of this app share the origin's localStorage, so any
// per-role state (simulator config, anonymous token, pairing) must live in
// sessionStorage, which is per tab. Keys are additionally namespaced by role so
// a tab that switches role never reads the other role's leftovers.

/**
 * Creates a namespaced key-value store over a Storage-like backend.
 * @param {string} namespace - prefix for every key (for example the tab role)
 * @param {Storage} [backend] - storage backend; defaults to window.sessionStorage
 * @returns {{get: function(string): string|null, set: function(string, string): void, remove: function(string): void}} the store
 */
export function createTabStorage(namespace, backend) {
  const storage = backend || resolveSessionStorage();
  const prefixed = (key) => `${namespace}:${key}`;

  return {
    get(key) {
      if (!storage) return null;
      try {
        return storage.getItem(prefixed(key));
      } catch (_) {
        return null;
      }
    },
    set(key, value) {
      if (!storage) return;
      try {
        storage.setItem(prefixed(key), String(value));
      } catch (_) {
        // storage unavailable (private mode, quota): the value still lives in memory
      }
    },
    remove(key) {
      if (!storage) return;
      try {
        storage.removeItem(prefixed(key));
      } catch (_) {
        // noop
      }
    },
  };
}

/**
 * Resolves sessionStorage, tolerating environments where access throws.
 * @returns {Storage|null} the session storage or null
 */
function resolveSessionStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch (_) {
    return null;
  }
}
