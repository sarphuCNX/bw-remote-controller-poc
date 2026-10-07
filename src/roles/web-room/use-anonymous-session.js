// Anonymous session — the web room's identity and control-plane socket, as the
// birdai-web landing page does it: POST /user/login for an anonymous token,
// then a `/user-events` socket.io connection carrying that token.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { createBirdApi } from './bird-api';
import { createTabStorage } from '../../shared/storage';

const TOKEN_KEY = 'anonymousToken';

/**
 * Decodes the `sub` (user id) of a JWT without verifying it (display only).
 * @param {string} token - the JWT
 * @returns {string} the subject or ''
 */
export function decodeSubject(token) {
  try {
    const payload = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub || payload.userId || '';
  } catch (_) {
    return '';
  }
}

/**
 * Creates the anonymous session and the control-plane socket.
 * @param {object} options - configuration
 * @param {string} options.birdUrl - bird-ai-server base URL
 * @param {function} [options.fetchFn] - injectable fetch
 * @param {function} [options.socketFactory] - injectable socket.io factory
 * @returns {{api: object, token: string, userId: string, socket: object|null, status: string, error: string, subscribe: function(function(object): void): function(): void}} the session
 */
export function useAnonymousSession({ birdUrl, fetchFn, socketFactory }) {
  const storage = useMemo(() => createTabStorage('web-room'), []);
  const api = useMemo(() => createBirdApi({ baseUrl: birdUrl, fetchFn }), [birdUrl, fetchFn]);
  const [token, setToken] = useState(() => storage.get(TOKEN_KEY) || '');
  const [status, setStatus] = useState('logging in');
  const [error, setError] = useState('');
  const [socket, setSocket] = useState(null);
  const listenersRef = useRef(new Set());

  // 1) token
  useEffect(() => {
    if (token) return;
    let cancelled = false;
    api
      .anonymousLogin()
      .then((next) => {
        if (cancelled) return;
        storage.set(TOKEN_KEY, next);
        setToken(next);
      })
      .catch((err) => !cancelled && setError(`login failed: ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, [api, storage, token]);

  // 2) socket, recreated whenever the token changes (the AW1 rule)
  useEffect(() => {
    if (!token) return undefined;
    const factory = socketFactory || io;
    const created = factory(birdUrl, {
      path: '/user-events',
      auth: (cb) => cb({ token }),
      transports: ['websocket'],
      reconnection: true,
    });
    const notify = (event) => listenersRef.current.forEach((fn) => fn(event));
    const onConnect = () => setStatus('connected');
    const onDisconnect = (reason) => setStatus(`disconnected (${reason})`);
    const onConnectError = (err) => {
      setStatus('connect error');
      setError(err && err.message ? err.message : 'connect error');
      // An invalid or expired token: drop it so the next mount logs in again.
      if (/forbidden/i.test(String(err && err.message))) {
        storage.remove(TOKEN_KEY);
        setToken('');
      }
    };
    const onMessage = (msg) => notify({ event: 'message', payload: msg });
    const onException = (msg) => notify({ event: 'exception', payload: msg });
    const onDeviceConnected = (msg) => notify({ event: 'DEVICE_CONNECTED', payload: msg });
    const onDeviceDisconnected = (msg) => notify({ event: 'DEVICE_DISCONNECTED', payload: msg });

    created.on('connect', onConnect);
    created.on('disconnect', onDisconnect);
    created.on('connect_error', onConnectError);
    created.on('message', onMessage);
    created.on('exception', onException);
    created.on('DEVICE_CONNECTED', onDeviceConnected);
    created.on('DEVICE_DISCONNECTED', onDeviceDisconnected);
    setSocket(created);
    setStatus('connecting');

    return () => {
      created.off('connect', onConnect);
      created.off('disconnect', onDisconnect);
      created.off('connect_error', onConnectError);
      created.off('message', onMessage);
      created.off('exception', onException);
      created.off('DEVICE_CONNECTED', onDeviceConnected);
      created.off('DEVICE_DISCONNECTED', onDeviceDisconnected);
      created.disconnect();
      setSocket(null);
    };
  }, [birdUrl, socketFactory, storage, token]);

  const subscribe = useCallback((listener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const resetSession = useCallback(() => {
    storage.remove(TOKEN_KEY);
    setToken('');
    setError('');
  }, [storage]);

  return { api, token, userId: decodeSubject(token), socket, status, error, subscribe, resetSession };
}
