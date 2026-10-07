// Device simulator constants — shared across the bird-device and panel-receiver
// cores and the React layer.

// bird-ai-server's device public key (RSA-OAEP / SHA-1). This is a bundled
// PUBLIC key by design — encrypting a hardwareId with it is exactly what a real
// device does (config.ts DEVICE.PUBLIC_KEY). Not a secret.
export const DEVICE_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu3HPa6lNcYQ/+18P74rApDnkgWiBgRnSw0+h0zK8Q+Kks5CNs56IcQUI612MQAIcvmwRlGBr7GBCbMUK0ZcaDBk6ggsAvfHgz7lP4NIcqZFVdjsuKUcJGeherFVRB4dm98okkLz8rdMAuWqHRwUXlajkiZuBnY17V1HAaBp4DuLNnyRNaUQGDMjYSKnm5HVz/NKiPWRSudfmQXxc4zsx/SaaaGMXr3StuD2YIh/9nLcQkzsTQ3pUwFQ6AT2BeMEEaVH+BYj+MCcb7cJASzxGarvVf1io58wmgY1a2fppzFaGRtb4Sh95e+6a4FVHVYEHPDuddzGkHGIX8rQJBrYrUQIDAQAB';

// Bird device socket event names (src/events/socket-devices/constants.ts).
export const BIRD_EVENTS = Object.freeze({
  TWO_FACTOR_AUTH_PIN: 'TWO_FACTOR_AUTH_PIN',
  PAIR_DEVICE: 'PAIR_DEVICE',
  PAIR_SUCCESSFUL: 'PAIR_SUCCESSFUL',
  UNPAIR_DEVICE: 'UNPAIR_DEVICE',
  SCREENSHARE_STARTED: 'SCREENSHARE_STARTED',
  SCREENSHARE_STOPPED: 'SCREENSHARE_STOPPED',
  START_MEETING: 'START_MEETING',
  MEETING_COMMAND: 'MEETING_COMMAND',
  REMOTE_CONTROL: 'REMOTE_CONTROL',
  CYMCAST_ROOM_CODE: 'CYMCAST_ROOM_CODE',
});

export const DEVICE_SIMULATOR_STORAGE_KEY = 'cymcast.deviceSimulator.v1';

// A friendly default name shown as "Connected to <name>" in the dashboard.
export const DEFAULT_DEVICE_NAME = 'Simulated Room';

// Panel receiver defaults (mirror the real receiver's resilience constants).
export const BASE_ICE_SERVERS = Object.freeze([
  Object.freeze({
    urls: Object.freeze(['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']),
  }),
]);
export const DISCONNECT_GRACE_MS = 8000;
export const DECODE_STALL_MS = 10000;
export const RESET_AFTER_RESTART_MS = 5000;
export const STATS_INTERVAL_MS = 2000;
export const PIN_TTL_MIN_MS = 10000;
export const PIN_TTL_MAX_MS = 10 * 60 * 1000;
