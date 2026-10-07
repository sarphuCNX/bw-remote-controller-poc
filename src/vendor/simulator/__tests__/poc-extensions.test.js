// Tests for the POC extensions applied to the vendored simulator cores:
// onRemoteControl + sendMeetingCommand (device core), onDataChannel (panel
// receiver) and version-aware isConfigReady (config).
import { createBirdDevice } from '../core/bird-device-core';
import { createPanelReceiver } from '../core/panel-receiver-core';
import { isConfigReady } from '../core/simulator-config';

/**
 * Minimal socket.io client stand-in.
 * @returns {{handlers: object, emitted: Array, on: function, emit: function, disconnect: function}} the fake socket
 */
function fakeSocket() {
  const handlers = {};
  const emitted = [];
  return {
    handlers,
    emitted,
    on: (event, fn) => {
      handlers[event] = fn;
    },
    emit: (event, payload) => emitted.push([event, payload]),
    disconnect: () => {},
  };
}

/**
 * Builds a live device over fakes.
 * @param {object} callbacks - device callbacks
 * @returns {Promise<{device: object, socket: object}>} the device and its socket
 */
async function liveDevice(callbacks) {
  const socket = fakeSocket();
  const device = createBirdDevice({
    birdUrl: 'https://bird.test',
    hardwareId: 'sim-1',
    encrypt: async () => 'enc',
    socketFactory: () => socket,
    fetchFn: async () => ({ ok: true, json: async () => ({ data: { deviceCode: 'ABCDE' } }) }),
    callbacks,
  });
  await device.goLive();
  return { device, socket };
}

describe('bird-device-core POC extensions', () => {
  test('remoteControlEvent_isForwardedToCallback', async () => {
    const received = [];
    const { socket } = await liveDevice({ onRemoteControl: (p) => received.push(p) });

    socket.handlers.REMOTE_CONTROL({ data: { additionalParameters: { type: 'MOUSE_MOVE' } } });

    expect(received).toEqual([{ data: { additionalParameters: { type: 'MOUSE_MOVE' } } }]);
  });

  test('sendMeetingCommand_emitsJsonStringOnMeetingCommandEvent', async () => {
    const { device, socket } = await liveDevice({});

    const sent = device.sendMeetingCommand({ userId: 'u1', kind: 'ack', seq: 3 });

    expect(sent).toBe(true);
    expect(socket.emitted).toEqual([['MEETING_COMMAND', JSON.stringify({ userId: 'u1', kind: 'ack', seq: 3 })]]);
  });

  test('sendMeetingCommand_beforeGoLive_returnsFalse', () => {
    const device = createBirdDevice({ birdUrl: 'https://bird.test', hardwareId: 'sim-1' });

    expect(device.sendMeetingCommand({ userId: 'u1' })).toBe(false);
  });
});

describe('panel-receiver-core onDataChannel', () => {
  test('incomingDataChannel_isSurfacedWithPcAndSessionId', async () => {
    const sockets = [];
    function FakeWs() {
      this.readyState = 1;
      this.send = () => {};
      this.close = () => {};
      sockets.push(this);
    }
    FakeWs.OPEN = 1;
    let pc;
    const surfaced = [];
    const receiver = createPanelReceiver({
      cymcastUrl: 'https://cymcast.test',
      panelSecret: 's',
      panelId: 'p1',
      webSocketFactory: FakeWs,
      peerConnectionFactory: () => {
        pc = {
          close: () => {},
          setRemoteDescription: async () => {},
          createAnswer: async () => ({ type: 'answer', sdp: 'a' }),
          setLocalDescription: async () => {},
          getTransceivers: () => [],
          localDescription: { sdp: 'a' },
        };
        return pc;
      },
      callbacks: { onDataChannel: (channel, connection, sessionId) => surfaced.push({ channel, connection, sessionId }) },
    });
    receiver.start();
    const socket = sockets[0];
    socket.onopen();
    socket.onmessage({ data: JSON.stringify({ type: 'peer', peer: 'sender', sessionId: 's1', sessionToken: 't1', iceServers: [] }) });
    socket.onmessage({ data: JSON.stringify({ type: 'offer', sessionId: 's1', sdp: 'offer' }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    pc.ondatachannel({ channel: { label: 'pointer' } });

    expect(surfaced).toEqual([{ channel: { label: 'pointer' }, connection: pc, sessionId: 's1' }]);
  });
});

describe('isConfigReady by version', () => {
  const base = { birdUrl: 'https://b', cymcastUrl: 'https://c', hardwareId: 'h', panelSecret: '' };

  test('isConfigReady_v1WithoutSecret_isFalse', () => {
    expect(isConfigReady({ ...base, version: 'v1' })).toBe(false);
  });

  test('isConfigReady_v3WithoutSecret_isTrue', () => {
    expect(isConfigReady({ ...base, version: 'v3' })).toBe(true);
  });

  test('isConfigReady_v3WithoutCymcastUrl_isFalse', () => {
    expect(isConfigReady({ ...base, version: 'v3', cymcastUrl: '' })).toBe(false);
  });
});
