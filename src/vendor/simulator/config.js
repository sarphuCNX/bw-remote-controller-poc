// Standalone default config for the device simulator (POC: production pair by default). The in-app config panel
// is the primary source (persisted to localStorage); these only seed the
// defaults. Override at build/dev time via Vite env vars (.env / .env.local):
//   VITE_BIRDAI_SERVER_URL, VITE_CYMCAST_SERVER_URL, VITE_CYMCAST_DEVICE_SECRET.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export default {
  /** bird-ai-server base URL (pairing: generate-code, generate-pin, pairDevice). */
  BIRDAI_SERVER_URL: env.VITE_BIRDAI_SERVER_URL || 'https://ubs-server.birdai.com',
  /** Cymcast signaling server base URL (cast: knock, ws, ice). */
  CYMCAST_SERVER_URL: env.VITE_CYMCAST_SERVER_URL || 'https://cymcast.birdai.com',
  /** Cymcast panel secret prefill (never bake a real fleet secret here). */
  CYMCAST_DEVICE_SECRET: env.VITE_CYMCAST_DEVICE_SECRET || '',
};
