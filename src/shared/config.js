// App configuration seeded from Vite env (.env.local). The panel role's config
// panel can override the URLs at runtime; the web room reads these directly.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

const config = Object.freeze({
  /** bird-ai-server base URL (pairing, presence, grants, REMOTE_CONTROL socket path). */
  BIRDAI_SERVER_URL: env.VITE_BIRDAI_SERVER_URL || 'https://ubs-server.birdai.com',
  /** cymcast signaling server base URL (connect with grant, offer/answer/ICE relay, TURN minting). */
  CYMCAST_SERVER_URL: env.VITE_CYMCAST_SERVER_URL || 'https://cymcast.birdai.com',
  /** Legacy panel secret (v1/v2 panel modes only; v3 uses a receiver token). */
  CYMCAST_DEVICE_SECRET: env.VITE_CYMCAST_DEVICE_SECRET || '',
});

export default config;
