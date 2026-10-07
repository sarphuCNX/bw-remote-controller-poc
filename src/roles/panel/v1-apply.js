// Applies today's v1 `REMOTE_CONTROL` socket payloads (birdai-web
// remote-control-dialog) to the same virtual cursor the DataChannel path
// drives, so both paths render identically and can be compared.
//
// bird-ai-server forwards the web payload as
//   { message, data: { deviceCode, meetingCommand: 'REMOTE_CONTROL', additionalParameters: <payload> } }

/**
 * Extracts the controller payload from a forwarded REMOTE_CONTROL event.
 * @param {object} event - the socket event payload
 * @returns {object|null} the controller payload (`type`, ...) or null
 */
export function extractV1Payload(event) {
  const params = event && event.data && event.data.additionalParameters;
  if (params && typeof params === 'object' && typeof params.type === 'string') return params;
  if (event && typeof event.type === 'string') return event; // already unwrapped
  return null;
}

/**
 * Applies a v1 payload to a cursor model.
 * @param {object} payload - the controller payload
 * @param {{x: number, y: number, buttons: number}} cursor - mutable cursor
 * @param {{width: number, height: number}} surface - virtual screen size
 * @returns {{kind: string, event?: object}} what happened: 'move' | 'wheel' | 'button' | 'click' | 'key' | 'probe' | 'session' | 'ignored'
 */
export function applyV1Payload(payload, cursor, surface) {
  switch (payload.type) {
    case 'MOUSE_MOVE': {
      const x = Number(payload.x);
      const y = Number(payload.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        cursor.x = Math.max(0, Math.min(1, x)) * surface.width;
        cursor.y = Math.max(0, Math.min(1, y)) * surface.height;
      }
      return { kind: 'move' };
    }
    case 'WHEEL':
      return { kind: 'wheel', event: { wheelX: Number(payload.x) || 0, wheelY: Number(payload.y) || 0 } };
    case 'MOUSE_DOWN':
      cursor.buttons |= 1;
      return { kind: 'button', event: { button: 0, down: true } };
    case 'MOUSE_UP':
      cursor.buttons &= ~1;
      return { kind: 'button', event: { button: 0, down: false } };
    case 'MOUSE_LEFT_CLICK':
      return { kind: 'click', event: { button: 0 } };
    case 'MOUSE_RIGHT_CLICK':
      return { kind: 'click', event: { button: 2 } };
    case 'KEYBOARD_PRESS':
      return {
        kind: 'key',
        event: {
          key: payload.key,
          mods: { ctrl: !!payload.ctrlKey, alt: !!payload.altKey, shift: !!payload.shiftKey, meta: !!payload.metaKey },
        },
      };
    case 'PROBE':
      return { kind: 'probe', event: { id: payload.id, ts: payload.ts } };
    case 'REMOTE_START':
    case 'REMOTE_STOP':
      return { kind: 'session', event: { type: payload.type } };
    default:
      return { kind: 'ignored' };
  }
}
