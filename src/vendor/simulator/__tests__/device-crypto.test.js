// Tests for device hardware-id encryption. Rather than depend on the server's
// private key, the test generates its own RSA-OAEP/SHA-1 keypair, encrypts with
// encryptHardwareId, and decrypts with the matching private key — proving the
// function produces ciphertext the corresponding private key (i.e. the server)
// can read.

// window.crypto (WebCrypto) and TextEncoder/TextDecoder are polyfilled for
// jsdom in vitest.setup.js so the device-crypto browser path is exercised.
import { encryptHardwareId, __test__ } from '../core/device-crypto';

const subtle = window.crypto.subtle;

/**
 * Exports a CryptoKey's SPKI as base64 (the format encryptHardwareId imports).
 * @param {CryptoKey} publicKey - the public key
 * @returns {Promise<string>} base64 SPKI
 */
const exportPublicKeyBase64 = async (publicKey) => {
  const spki = await subtle.exportKey('spki', publicKey);
  return __test__.bytesToBase64(spki);
};

/**
 * Generates an RSA-OAEP/SHA-1 keypair for round-trip testing.
 * @returns {Promise<CryptoKeyPair>} the keypair
 */
const generateKeyPair = () =>
  subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-1',
    },
    true,
    ['encrypt', 'decrypt'],
  );

describe('encryptHardwareId', () => {
  test('produces ciphertext the matching private key decrypts back to the hardware id', async () => {
    const keyPair = await generateKeyPair();
    const publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);

    const ciphertext = await encryptHardwareId('sim-hw-abc123', publicKeyBase64);
    const decrypted = await subtle.decrypt(
      { name: 'RSA-OAEP' },
      keyPair.privateKey,
      __test__.base64ToBytes(ciphertext),
    );

    expect(new TextDecoder().decode(decrypted)).toBe('sim-hw-abc123');
  });

  test('returns a base64 string', async () => {
    const keyPair = await generateKeyPair();
    const publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);

    const ciphertext = await encryptHardwareId('device-1', publicKeyBase64);

    expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  test('OAEP randomizes output — two encryptions of the same id differ', async () => {
    const keyPair = await generateKeyPair();
    const publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);

    const first = await encryptHardwareId('device-1', publicKeyBase64);
    const second = await encryptHardwareId('device-1', publicKeyBase64);

    expect(first).not.toBe(second);
  });

  test('the bundled device public key imports and encrypts without error', async () => {
    const ciphertext = await encryptHardwareId('sim-hw-xyz');

    expect(typeof ciphertext).toBe('string');
    expect(ciphertext.length).toBeGreaterThan(0);
  });
});
