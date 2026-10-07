// Cymcast endpoint URLs, derived from the configured server base URL.
//
// The upstream sender is same-origin (relative /knock, /ws, /ice, /telemetry);
// in birdai-web the signaling server is external, so every endpoint is rebased
// onto config.CYMCAST_SERVER_URL here — the single place URL shape is decided.

/**
 * Builds the four Cymcast endpoint URLs from a server base URL.
 * @param {string} baseUrl - e.g. "https://cymcast.aifpd.com" (trailing slashes tolerated)
 * @returns {{knock: string, ice: string, telemetry: string, ws: string}} absolute endpoint URLs
 * @throws {Error} when baseUrl is empty or not http(s)
 */
export function buildCymcastUrls(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`cymcast server URL must be http(s), got: "${baseUrl}"`);
  }
  const wsBase = trimmed.replace(/^http/i, 'ws'); // https → wss, http → ws
  return {
    knock: `${trimmed}/knock`,
    ice: `${trimmed}/ice`,
    telemetry: `${trimmed}/telemetry`,
    ws: `${wsBase}/ws`,
  };
}
