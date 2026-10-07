// Transport sinks for the input pipeline. The pipeline is identical for both;
// only the sink changes, which is what makes the comparison fair.

import { encodePointerFrame } from '../../shared/protocol/pointer-frame';
import { CONTROL_MESSAGE, encodeControlMessage } from '../../shared/protocol/control-messages';

// Today's socket payload types (birdai-web remote-control-dialog/container.jsx).
export const V1_TYPES = Object.freeze({
  MOUSE_MOVE: 'MOUSE_MOVE',
  MOUSE_DOWN: 'MOUSE_DOWN',
  MOUSE_UP: 'MOUSE_UP',
  MOUSE_LEFT_CLICK: 'MOUSE_LEFT_CLICK',
  MOUSE_RIGHT_CLICK: 'MOUSE_RIGHT_CLICK',
  WHEEL: 'WHEEL',
  TWO_FINGERS_MOVE: 'TWO_FINGERS_MOVE',
  KEYBOARD_PRESS: 'KEYBOARD_PRESS',
  REMOTE_START: 'REMOTE_START',
  REMOTE_STOP: 'REMOTE_STOP',
});

export const SOCKET_CHANNEL = 'REMOTE_CONTROL';

/**
 * Sink over the two WebRTC DataChannels.
 * @param {object} channels - the channels
 * @param {RTCDataChannel} channels.pointerChannel - unordered, no retransmits
 * @param {RTCDataChannel} channels.controlChannel - reliable, ordered
 * @returns {{sendPointer: function(object): void, sendDiscrete: function(object): void, isConnected: function(): boolean, name: string}} the sink
 */
export function createDataChannelSink({ pointerChannel, controlChannel }) {
  const open = (channel) => !!channel && channel.readyState === 'open';
  return {
    name: 'datachannel',
    sendPointer(frame) {
      if (!open(pointerChannel)) return;
      pointerChannel.send(encodePointerFrame(frame));
    },
    sendDiscrete(message) {
      if (!open(controlChannel)) return;
      controlChannel.send(encodeControlMessage(message));
    },
    isConnected: () => open(pointerChannel) && open(controlChannel),
  };
}

/**
 * Sink over today's socket.io path, producing the v1 `REMOTE_CONTROL` payloads
 * the panel already understands. Keeps a virtual cursor so relative deltas
 * become the absolute normalized `MOUSE_MOVE` the v1 protocol expects.
 * @param {object} options - configuration
 * @param {function(string, object): void} options.emit - socket emit (channel, payload)
 * @param {function(): boolean} options.isConnected - socket connectivity
 * @param {{width: number, height: number}} [options.surface] - virtual surface size for the cursor
 * @returns {{sendPointer: function(object): void, sendDiscrete: function(object): void, isConnected: function(): boolean, name: string, cursor: function(): {x: number, y: number}}} the sink
 */
export function createSocketSink({ emit, isConnected, surface = { width: 1920, height: 1080 } }) {
  const cursor = { x: surface.width / 2, y: surface.height / 2 };
  const clamp = (v, max) => Math.max(0, Math.min(max, v));

  function sendMove(frame) {
    if (frame.absolute) {
      cursor.x = (frame.dx / 65535) * surface.width;
      cursor.y = (frame.dy / 65535) * surface.height;
    } else {
      cursor.x = clamp(cursor.x + frame.dx, surface.width);
      cursor.y = clamp(cursor.y + frame.dy, surface.height);
    }
    emit(SOCKET_CHANNEL, {
      type: V1_TYPES.MOUSE_MOVE,
      x: cursor.x / surface.width,
      y: cursor.y / surface.height,
    });
  }

  return {
    name: 'socket',
    sendPointer(frame) {
      if (!isConnected()) return;
      if (frame.dx || frame.dy || frame.absolute) sendMove(frame);
      if (frame.wheelX || frame.wheelY) {
        emit(SOCKET_CHANNEL, { type: V1_TYPES.WHEEL, x: frame.wheelX, y: frame.wheelY });
      }
    },
    sendDiscrete(message) {
      if (!isConnected()) return;
      if (message.t === CONTROL_MESSAGE.BUTTON) {
        if (message.button === 0) {
          emit(SOCKET_CHANNEL, { type: message.down ? V1_TYPES.MOUSE_DOWN : V1_TYPES.MOUSE_UP });
        } else if (message.button === 2 && message.down) {
          emit(SOCKET_CHANNEL, { type: V1_TYPES.MOUSE_RIGHT_CLICK });
        }
        return;
      }
      if (message.t === CONTROL_MESSAGE.CLICK) {
        emit(SOCKET_CHANNEL, {
          type: message.button === 2 ? V1_TYPES.MOUSE_RIGHT_CLICK : V1_TYPES.MOUSE_LEFT_CLICK,
        });
        return;
      }
      if (message.t === CONTROL_MESSAGE.KEY && message.down) {
        // v1 has no key-up: only presses exist on the socket path.
        const mods = message.mods || {};
        emit(SOCKET_CHANNEL, {
          type: V1_TYPES.KEYBOARD_PRESS,
          key: message.key,
          ctrlKey: !!mods.ctrl,
          altKey: !!mods.alt,
          shiftKey: !!mods.shift,
          metaKey: !!mods.meta,
        });
      }
    },
    isConnected,
    cursor: () => ({ ...cursor }),
  };
}
