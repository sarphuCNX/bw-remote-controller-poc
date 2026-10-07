// Simulator versions — the single source of truth for the flows this simulator
// can stand in for. Each version fixes both the human description shown in the
// UI and the behavior flags the device/panel cores read, so "what a version
// does" is defined in exactly one place.
//
// The versions mirror the Cymcast product's own evolution:
//   v1 — Room code + cast PIN: the panel reports its Cymcast room code to
//        bird-ai-server and reveals a cast PIN when a sender knocks. The web
//        resolves the room code and the presenter types the PIN.
//   v2 — Grant-based: pairing is the authorization. The web mints a short-lived
//        grant from bird-ai-server and connects directly — no room-code report,
//        no cast PIN. See the "Cymcast v2 — Grant-Based Signaling" proposal.
//   v3 — Token-based panel auth: the panel fetches a per-device receiver token
//        from bird-ai-server and registers with cymcast using that token
//        instead of the shared fleet device_secret. Casting is v2's grant flow.

export const SIMULATOR_VERSION_IDS = Object.freeze({
  V1: 'v1',
  V2: 'v2',
  V3: 'v3',
});

// Default to v1 — the established flow — so existing behavior is unchanged
// until a tester explicitly selects v2.
export const DEFAULT_VERSION_ID = SIMULATOR_VERSION_IDS.V1;

const VERSIONS = Object.freeze([
  Object.freeze({
    id: SIMULATOR_VERSION_IDS.V1,
    label: 'v1 — Room code + cast PIN',
    description:
      'The original flow. The panel reports its Cymcast room code to bird-ai-server, ' +
      'advertises show-pin, and reveals a cast PIN when a sender knocks. The dashboard ' +
      'resolves the room code and the presenter types the cast PIN to start sharing.',
    behavior: Object.freeze({
      // Advertise features:['show-pin'] so the server reveals the cast PIN on knock.
      advertiseShowPin: true,
      // Report CYMCAST_ROOM_CODE to bird so the dashboard can resolve it by hardwareId.
      reportRoomCode: true,
      // Register with cymcast using the shared device_secret (not a per-device token).
      registerWithToken: false,
    }),
  }),
  Object.freeze({
    id: SIMULATOR_VERSION_IDS.V2,
    label: 'v2 — Grant-based (paired cast, no PIN)',
    description:
      'The signaling-only flow. Pairing is the authorization: the dashboard mints a ' +
      'short-lived cast grant from bird-ai-server and connects directly, so there is no ' +
      'room-code report and no cast PIN. The panel simply renders the grant-authorized cast.',
    behavior: Object.freeze({
      advertiseShowPin: false,
      reportRoomCode: false,
      registerWithToken: false,
    }),
  }),
  Object.freeze({
    id: SIMULATOR_VERSION_IDS.V3,
    label: 'v3 — Token-based panel auth (no device secret)',
    description:
      'The final flow. The panel fetches a per-device receiver token from ' +
      'bird-ai-server (POST /device/cymcast-receiver-token) and registers with ' +
      'cymcast using that token instead of the shared device_secret — so no ' +
      'fleet secret is stored on the device. Casting is the same grant-based ' +
      'flow as v2: no room-code report, no cast PIN.',
    behavior: Object.freeze({
      advertiseShowPin: false,
      reportRoomCode: false,
      // Register with cymcast using a per-device CAST_RECEIVE token from bird.
      registerWithToken: true,
    }),
  }),
]);

export const SIMULATOR_VERSIONS = VERSIONS;

/**
 * Resolves a version descriptor by id, falling back to the default for unknown
 * or missing ids (so persisted config from an older build never breaks).
 * @param {string} id - the version id
 * @returns {{id: string, label: string, description: string, behavior: {advertiseShowPin: boolean, reportRoomCode: boolean}}} the version descriptor
 */
export function getVersion(id) {
  return VERSIONS.find((version) => version.id === id) || getVersion(DEFAULT_VERSION_ID);
}

/**
 * True when the id is a known simulator version.
 * @param {string} id - the version id to check
 * @returns {boolean} whether the id is recognized
 */
export function isKnownVersion(id) {
  return VERSIONS.some((version) => version.id === id);
}
