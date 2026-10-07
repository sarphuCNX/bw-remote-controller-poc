import { useCallback, useEffect, useRef, useState } from 'react';
import { createBirdDevice } from '../core/bird-device-core';
import { createPanelReceiver } from '../core/panel-receiver-core';
import { DEFAULT_VERSION_ID, getVersion } from '../core/simulator-versions';

/**
 * Extracts the user room id from a PAIR_DEVICE user object (same rule as the
 * device core: userId, sub, or id).
 * @param {object} user - the user object from PAIR_DEVICE
 * @returns {string} the room id or ''
 */
function userRoomIdOf(user) {
  if (!user || typeof user !== 'object') return '';
  return user.userId || user.sub || user.id || '';
}

const IDLE_STATE = Object.freeze({
  phase: 'idle', // 'idle' | 'connecting' | 'online'
  version: DEFAULT_VERSION_ID, // active simulator version for this run
  deviceCode: '',
  room: null, // { code, displayPin, joinUrl }
  cymcastRoomCode: '', // Cymcast-assigned room code (independent of the bird deviceCode)
  pairingPin: null, // bird 2FA PIN (for the dashboard pairing dialog)
  castPin: null, // { value, expiresAt } — cymcast PIN (for the cast dialog)
  paired: false,
  pairedUserId: '', // user room id of the paired controller (PAIR_DEVICE payload)
  deviceName: '',
  casting: false,
  stats: null,
  birdStatus: '',
  panelStatus: '',
  error: '',
});

/**
 * Orchestrates the Bird device + Cymcast panel cores behind a single "Go live"
 * action. The Cymcast panel registers with panelId = hardwareId (as a real
 * bird panel does) and receives an independently-assigned Cymcast room code,
 * which the device reports back to bird-ai-server. The bird deviceCode drives
 * pairing; the Cymcast room code drives casting — they are distinct values.
 *
 * @param {object} [options] - optional hooks for the POC control plane
 * @param {function} [options.onDataChannel] - (channel, pc, sessionId) when the sender opens a DataChannel
 * @param {function} [options.onRemoteControl] - (payload) for REMOTE_CONTROL socket events
 * @returns {object} simulator state + controls:
 *   { ...IDLE_STATE, videoStreamRef, goLive(config), stop() }
 */
export const useDeviceSimulator = ({ onDataChannel, onRemoteControl } = {}) => {
  const [state, setState] = useState(IDLE_STATE);
  const birdRef = useRef(null);
  const panelRef = useRef(null);
  const roomRef = useRef(null);
  const reportedCodeRef = useRef('');
  const videoStreamRef = useRef(null);
  const mountedRef = useRef(true);
  const [, forceStream] = useState(0);

  const patch = useCallback((next) => {
    if (mountedRef.current) setState((prev) => ({ ...prev, ...next }));
  }, []);

  const teardown = useCallback(() => {
    if (birdRef.current) {
      birdRef.current.stop();
      birdRef.current = null;
    }
    if (panelRef.current) {
      panelRef.current.stop();
      panelRef.current = null;
    }
    roomRef.current = null;
    reportedCodeRef.current = '';
    videoStreamRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  const goLive = useCallback(
    async (config) => {
      teardown();
      const version = getVersion(config.version);
      setState({ ...IDLE_STATE, phase: 'connecting', version: version.id });

      const bird = createBirdDevice({
        birdUrl: config.birdUrl,
        hardwareId: config.hardwareId,
        deviceName: config.deviceName,
        callbacks: {
          onStatus: (text) => patch({ birdStatus: text }),
          onDeviceCode: (deviceCode) => patch({ deviceCode }),
          onPairingPin: (pin) => patch({ pairingPin: pin }),
          onPaired: ({ deviceName, user }) =>
            patch({ paired: true, deviceName, pairedUserId: userRoomIdOf(user) }),
          onUnpaired: () => patch({ paired: false, deviceName: '', pairedUserId: '' }),
          onError: (error) =>
            patch({ error: String((error && error.message) || error || 'error') }),
          onRemoteControl: (payload) => {
            if (onRemoteControl) onRemoteControl(payload);
          },
        },
      });
      birdRef.current = bird;

      let deviceCode;
      try {
        deviceCode = await bird.goLive();
      } catch (error) {
        patch({
          phase: 'idle',
          error: String((error && error.message) || error || 'go-live failed'),
        });
        teardown();
        return;
      }
      if (!mountedRef.current) return;

      const panel = createPanelReceiver({
        cymcastUrl: config.cymcastUrl,
        panelSecret: config.panelSecret,
        panelId: String(config.hardwareId),
        advertiseShowPin: version.behavior.advertiseShowPin,
        // v3: register with a per-device receiver token fetched from bird
        // instead of the shared device_secret.
        getRegisterToken: version.behavior.registerWithToken
          ? () => birdRef.current.fetchCymcastReceiverToken()
          : null,
        callbacks: {
          onStatus: (text) => patch({ panelStatus: text }),
          onRoom: (room) => {
            roomRef.current = room;
            const code = (room && room.code) || '';
            patch({ room, cymcastRoomCode: code });
            // v1 only: report the Cymcast room code to bird-ai-server once per
            // code so the dashboard can resolve it by hardwareId after pairing.
            // v2 resolves via the pairing grant, so this loop is dead there.
            if (
              version.behavior.reportRoomCode &&
              code &&
              code !== reportedCodeRef.current &&
              birdRef.current
            ) {
              reportedCodeRef.current = code;
              birdRef.current.reportCymcastRoomCode(code);
            }
          },
          onCastPin: (ttlMs) => {
            const room = roomRef.current;
            if (room && room.displayPin) {
              patch({ castPin: { value: room.displayPin, expiresAt: Date.now() + ttlMs } });
            }
          },
          onVideoTrack: (stream) => {
            videoStreamRef.current = stream || null;
            forceStream((n) => n + 1);
          },
          onCasting: (casting) =>
            patch(casting ? { casting: true, castPin: null } : { casting: false }),
          onStats: (stats) => patch({ stats }),
          onError: (_code, message) => patch({ error: message }),
          onDataChannel: (channel, pc, sessionId) => {
            if (onDataChannel) onDataChannel(channel, pc, sessionId);
          },
        },
      });
      panelRef.current = panel;
      panel.start();

      patch({ phase: 'online', deviceCode });
    },
    [patch, teardown, onDataChannel, onRemoteControl],
  );

  const stop = useCallback(() => {
    teardown();
    setState(IDLE_STATE);
  }, [teardown]);

  const dropPanelSocket = useCallback(() => {
    if (panelRef.current) panelRef.current.dropSocket();
  }, []);

  const sendMeetingCommand = useCallback((payload) => {
    return birdRef.current ? birdRef.current.sendMeetingCommand(payload) : false;
  }, []);

  return { ...state, videoStreamRef, goLive, stop, dropPanelSocket, sendMeetingCommand };
};
