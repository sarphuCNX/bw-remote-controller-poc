// Device hardware-id encryption — mints the `encryptedHardwareId` a Bird device
// socket authenticates with.
//
// bird-ai-server encrypts/decrypts with node-rsa's default scheme, which is
// RSA-OAEP with SHA-1 (verified by round-trip against the server's private
// key). WebCrypto supports exactly that, so no third-party RSA library is
// needed — the browser (and Node's global webcrypto under Jest) does it.

import { DEVICE_PUBLIC_KEY } from './constants';

const OAEP_SHA1 = Object.freeze({ name: 'RSA-OAEP', hash: 'SHA-1' });

/**
 * Resolves the WebCrypto SubtleCrypto implementation (browser or Node global).
 * @returns {SubtleCrypto} the subtle crypto instance
 * @throws {Error} when WebCrypto is unavailable
 */
function getSubtle() {
  const webcrypto = typeof window !== 'undefined' ? window.crypto : undefined;
  if (!webcrypto || !webcrypto.subtle) {
    throw new Error('WebCrypto (crypto.subtle) is unavailable in this environment');
  }
  return webcrypto.subtle;
}

/**
 * Decodes a base64 string to a byte array.
 * @param {string} base64 - base64-encoded input
 * @returns {Uint8Array} decoded bytes
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encodes a byte array (or ArrayBuffer) to a base64 string.
 * @param {ArrayBuffer|Uint8Array} buffer - bytes to encode
 * @returns {string} base64 string
 */
function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Encrypts a hardwareId into the base64 `encryptedHardwareId` the Bird device
 * socket expects, using RSA-OAEP/SHA-1 to match bird-ai-server's node-rsa.
 * @param {string} hardwareId - the device hardware id
 * @param {string} [publicKeyBase64] - base64 SPKI RSA public key (defaults to the bundled device key)
 * @returns {Promise<string>} base64-encoded ciphertext
 */
export async function encryptHardwareId(hardwareId, publicKeyBase64 = DEVICE_PUBLIC_KEY) {
  const subtle = getSubtle();
  const key = await subtle.importKey('spki', base64ToBytes(publicKeyBase64), OAEP_SHA1, false, [
    'encrypt',
  ]);
  const ciphertext = await subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(String(hardwareId)),
  );
  return bytesToBase64(ciphertext);
}

export const __test__ = { base64ToBytes, bytesToBase64 };
