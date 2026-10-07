// Device simulator configuration — persisted to localStorage so a developer's
// server URLs, panel secret, and hardware id survive reloads. The UI config
// panel is the primary source; dashboard `config` + env only seed defaults.

import config from '../config';
import { DEVICE_SIMULATOR_STORAGE_KEY } from './constants';
import { DEFAULT_VERSION_ID, getVersion, isKnownVersion } from './simulator-versions';

/**
 * Resolves the storage backend, tolerating environments where accessing
 * window.localStorage throws (locked-down/incognito).
 * @param {Storage} [storage] - injected localStorage-like object
 * @returns {Storage|null} usable storage or null
 */
function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

/**
 * Generates a stable, opaque hardware id for the simulated device.
 * @returns {string} a hardware id like "sim-<random>"
 */
function generateHardwareId() {
  const webcrypto = typeof window !== 'undefined' ? window.crypto : undefined;
  const rand =
    webcrypto && webcrypto.randomUUID
      ? webcrypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `sim-${rand}`;
}

/**
 * The default config, seeded from the dashboard's own config + env.
 * @returns {{birdUrl: string, cymcastUrl: string, panelSecret: string, hardwareId: string, deviceName: string}} defaults
 */
export function defaultConfig() {
  return {
    birdUrl: config.BIRDAI_SERVER_URL || '',
    cymcastUrl: config.CYMCAST_SERVER_URL || '',
    panelSecret: config.CYMCAST_DEVICE_SECRET || '',
    hardwareId: generateHardwareId(),
    deviceName: 'Simulated Room',
    version: DEFAULT_VERSION_ID,
  };
}

/**
 * Reads persisted simulator config, merged over defaults; a fresh hardwareId is
 * generated and persisted on first use so the simulator reuses one device.
 * @param {Storage} [storage] - localStorage-like object (injectable for tests)
 * @returns {{birdUrl: string, cymcastUrl: string, panelSecret: string, hardwareId: string, deviceName: string}} config
 */
export function readConfig(storage) {
  const defaults = defaultConfig();
  const backend = resolveStorage(storage);
  if (!backend) return defaults;
  let stored = {};
  try {
    stored = JSON.parse(backend.getItem(DEVICE_SIMULATOR_STORAGE_KEY) || '{}') || {};
  } catch (_) {
    stored = {};
  }
  const merged = {
    birdUrl: typeof stored.birdUrl === 'string' ? stored.birdUrl : defaults.birdUrl,
    cymcastUrl: typeof stored.cymcastUrl === 'string' ? stored.cymcastUrl : defaults.cymcastUrl,
    panelSecret: typeof stored.panelSecret === 'string' ? stored.panelSecret : defaults.panelSecret,
    hardwareId:
      typeof stored.hardwareId === 'string' && stored.hardwareId
        ? stored.hardwareId
        : defaults.hardwareId,
    deviceName: typeof stored.deviceName === 'string' ? stored.deviceName : defaults.deviceName,
    // Unknown/absent version (e.g. config persisted by an older build) falls
    // back to the default rather than breaking go-live.
    version: isKnownVersion(stored.version) ? stored.version : defaults.version,
  };
  if (merged.hardwareId !== stored.hardwareId) saveConfig(merged, storage);
  return merged;
}

/**
 * Persists simulator config; failures are swallowed (incognito/locked storage).
 * @param {object} nextConfig - the config to persist
 * @param {Storage} [storage] - localStorage-like object (injectable for tests)
 * @returns {void}
 */
export function saveConfig(nextConfig, storage) {
  const backend = resolveStorage(storage);
  if (!backend) return;
  try {
    backend.setItem(DEVICE_SIMULATOR_STORAGE_KEY, JSON.stringify(nextConfig));
  } catch (_) {
    // storage unavailable — config still applies in memory
  }
}

/**
 * Validates that the config has the fields required to go live.
 * @param {object} candidate - config to validate
 * @returns {boolean} true when birdUrl, cymcastUrl, hardwareId are set, and panelSecret too
 *   unless the selected version registers with a per-device token (v3)
 */
export function isConfigReady(candidate) {
  if (!candidate) return false;
  const needsSecret = !getVersion(candidate.version).behavior.registerWithToken;
  return !!(
    candidate.birdUrl &&
    candidate.cymcastUrl &&
    candidate.hardwareId &&
    (!needsSecret || candidate.panelSecret)
  );
}
