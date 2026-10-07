import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

// jsdom lacks SubtleCrypto and (historically) TextEncoder/TextDecoder; real
// browsers have all three. Provide Node's equivalents so the vendored
// device-crypto path (RSA-OAEP/SHA-1 via window.crypto.subtle) runs as in a browser.
if (!window.crypto || !window.crypto.subtle) {
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
}
if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = TextEncoder;
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = TextDecoder;
