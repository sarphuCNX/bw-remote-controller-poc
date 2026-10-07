// Pairing — Room ID then PIN, exactly the production endpoints
// (device-2fa/generate-pin, device/pairDevice, device/getPairDeviceStatus,
// device/unpairDevice). Paired state is confirmed by the socket message
// PAIR_SUCCESSFUL and cleared by UNPAIR_DEVICE; REST status is checked on
// (re)connect so the UI never shows a stale state.

import { useCallback, useEffect, useRef, useState } from 'react';

export const PAIRING_STEP = Object.freeze({
  ROOM_ID: 'room-id',
  PIN: 'pin',
  PAIRING: 'pairing',
  PAIRED: 'paired',
});

/**
 * Pairing state machine over the anonymous session.
 * @param {object} options - configuration
 * @param {object} options.api - bird API client
 * @param {string} options.token - caller JWT
 * @param {function} options.subscribe - session event subscription
 * @param {string} options.socketStatus - session socket status (to refetch on connect)
 * @returns {object} pairing state and actions
 */
export function usePairing({ api, token, subscribe, socketStatus }) {
  const [step, setStep] = useState(PAIRING_STEP.ROOM_ID);
  const [roomId, setRoomId] = useState('');
  const [pin, setPin] = useState('');
  const [hardwareId, setHardwareId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lastSocketEventAtRef = useRef(0);

  // Socket-driven confirmation and teardown.
  useEffect(() => {
    return subscribe(({ event, payload }) => {
      if (event !== 'message' || !payload) return;
      lastSocketEventAtRef.current = Date.now();
      if (payload.type === 'PAIR_SUCCESSFUL') {
        setStep(PAIRING_STEP.PAIRED);
        setDeviceName(payload.deviceName || '');
        setMessage('paired');
      } else if (payload.type === 'UNPAIR_DEVICE') {
        setStep(PAIRING_STEP.ROOM_ID);
        setPin('');
        setMessage('unpaired by the panel or server');
      }
    });
  }, [subscribe]);

  // REST status on every (re)connect, so a stale UI state cannot survive. The
  // answer is ignored if the effect was torn down meanwhile, or if a socket
  // message (the fresher source) arrived after the request was made.
  useEffect(() => {
    if (!token || socketStatus !== 'connected') return undefined;
    let cancelled = false;
    const requestedAt = Date.now();
    api
      .pairStatus(token)
      .then((status) => {
        if (cancelled || lastSocketEventAtRef.current > requestedAt) return;
        if (status.message === 'CONNECTED') {
          setStep(PAIRING_STEP.PAIRED);
          setHardwareId((status.data && status.data.hardwareId) || '');
          setRoomId((status.data && status.data.deviceCode) || '');
          setDeviceName((status.data && status.data.deviceName) || '');
          return;
        }
        // The server says we are not paired (for example it unpaired us while
        // the socket was down): never keep showing a paired UI.
        setStep((current) => (current === PAIRING_STEP.PAIRED ? PAIRING_STEP.ROOM_ID : current));
        setMessage((current) => (current === 'paired' ? 'pairing ended while offline' : current));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, token, socketStatus]);

  const requestPin = useCallback(async () => {
    const code = roomId.trim().toUpperCase();
    if (!code) return setMessage('enter the Room ID');
    setBusy(true);
    setMessage('');
    try {
      await api.generatePin(token, code);
      setRoomId(code);
      setStep(PAIRING_STEP.PIN);
      setMessage('PIN sent to the panel');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }, [api, roomId, token]);

  const pair = useCallback(async () => {
    if (!pin.trim()) return setMessage('enter the PIN');
    setBusy(true);
    setStep(PAIRING_STEP.PAIRING);
    try {
      const result = await api.pairDevice(token, { deviceCode: roomId, pin: pin.trim() });
      setHardwareId(result.hardwareId || '');
      setMessage('pair request accepted, waiting for the panel');
    } catch (err) {
      setStep(PAIRING_STEP.PIN);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }, [api, pin, roomId, token]);

  const unpair = useCallback(async () => {
    setBusy(true);
    try {
      await api.unpair(token);
      setStep(PAIRING_STEP.ROOM_ID);
      setPin('');
      setMessage('unpaired');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }, [api, token]);

  return {
    step,
    roomId,
    setRoomId,
    pin,
    setPin,
    hardwareId,
    deviceName,
    message,
    busy,
    requestPin,
    pair,
    unpair,
    isPaired: step === PAIRING_STEP.PAIRED,
  };
}
