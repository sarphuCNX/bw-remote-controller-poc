// Tests for the Cymcast panel receiver core with fake WebSocket +
// RTCPeerConnection. Exercises registration, offer→answer, ICE stamping/
// buffering, bye→idle, restart-on-ice-failed, and grace re-adopt.

import { createPanelReceiver } from '../core/panel-receiver-core';

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }
  serverSays(msg) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) });
  }
}
FakeWebSocket.OPEN = 1;
FakeWebSocket.instances = [];

class FakePeerConnection {
  constructor(config) {
    this.config = config;
    this.remoteDescription = null;
    this.localDescription = null;
    this.iceConnectionState = 'new';
    this.onicecandidate = null;
    this.ontrack = null;
    this.oniceconnectionstatechange = null;
    this.addedCandidates = [];
    FakePeerConnection.instances.push(this);
  }
  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 fake-answer' };
  }
  async setLocalDescription(desc) {
    this.localDescription = { type: desc.type, sdp: desc.sdp || 'v=0 fake-answer' };
  }
  async addIceCandidate(c) {
    this.addedCandidates.push(c);
  }
  getTransceivers() {
    return [];
  }
  async getStats() {
    return new Map();
  }
  close() {
    this.iceConnectionState = 'closed';
  }
  fireIceState(state) {
    this.iceConnectionState = state;
    if (this.oniceconnectionstatechange) this.oniceconnectionstatechange();
  }
  fireTrack(kind) {
    if (this.ontrack) {
      this.ontrack({ track: { kind }, streams: [{ id: 'stream-1' }] });
    }
  }
}
FakePeerConnection.instances = [];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const PEER = {
  type: 'peer',
  peer: 'sender',
  sessionId: 'sess-1',
  sessionToken: 'tok-1',
  iceServers: [{ urls: ['turn:t.test:3478'], username: 'u', credential: 'c' }],
};

const createReceiver = (overrides = {}) => {
  const callbacks = {
    onStatus: vi.fn(),
    onRoom: vi.fn(),
    onCastPin: vi.fn(),
    onVideoTrack: vi.fn(),
    onStats: vi.fn(),
    onCasting: vi.fn(),
    onError: vi.fn(),
  };
  const receiver = createPanelReceiver({
    cymcastUrl: 'http://localhost:8787',
    panelSecret: 'dev',
    panelId: 'sim-panel',
    requestedCode: 'ABC12',
    callbacks,
    webSocketFactory: FakeWebSocket,
    peerConnectionFactory: (cfg) => new FakePeerConnection(cfg),
    ...overrides,
  });
  return { receiver, callbacks };
};

const startAndOpen = () => {
  const ctx = createReceiver();
  ctx.receiver.start();
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  socket.open();
  ctx.socket = socket;
  return ctx;
};

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakePeerConnection.instances = [];
  global.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks || [];
    }
  };
});

describe('panel registration', () => {
  test('connects to the ws endpoint derived from the cymcast url', () => {
    const { socket } = startAndOpen();

    expect(socket.url).toBe('ws://localhost:8787/ws');
  });

  test('registers with the show-pin feature and the requested code', () => {
    const { socket } = startAndOpen();

    const register = socket.sent.find((m) => m.type === 'panel-register');
    expect(register).toMatchObject({
      deviceSecret: 'dev',
      panelId: 'sim-panel',
      features: ['show-pin'],
      requestedCode: 'ABC12',
    });
  });

  test('a room message surfaces the code and PIN', () => {
    const { socket, callbacks } = startAndOpen();

    socket.serverSays({
      type: 'room',
      room: { code: 'ABC12', displayPin: '004271', joinUrl: 'x' },
    });

    expect(callbacks.onRoom).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ABC12', displayPin: '004271' }),
    );
  });

  test('a show-pin message surfaces the cast PIN with its TTL', () => {
    const { socket, callbacks } = startAndOpen();

    socket.serverSays({ type: 'show-pin', ttlMs: 60000 });

    expect(callbacks.onCastPin).toHaveBeenCalledWith(60000);
  });

  test('advertiseShowPin=false registers with no features (v2)', () => {
    const ctx = createReceiver({ advertiseShowPin: false });
    ctx.receiver.start();
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    socket.open();

    const register = socket.sent.find((m) => m.type === 'panel-register');
    expect(register.features).toEqual([]);
  });

  test('getRegisterToken registers with the token, not the device_secret (v3)', async () => {
    const ctx = createReceiver({
      advertiseShowPin: false,
      getRegisterToken: () => Promise.resolve('receiver-token-xyz'),
    });
    ctx.receiver.start();
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const register = socket.sent.find((m) => m.type === 'panel-register');
    expect(register.token).toBe('receiver-token-xyz');
    expect(register.deviceSecret).toBeUndefined();
    expect(register.panelId).toBeUndefined();
    expect(register.features).toEqual([]);
  });
});

describe('offer / answer', () => {
  test('an offer after a peer produces an answer stamped with the session ids', async () => {
    const { socket } = startAndOpen();
    socket.serverSays(PEER);

    socket.serverSays({ type: 'offer', sessionId: 'sess-1', sdp: 'v=0 offer' });
    await flush();

    expect(socket.sent).toContainEqual({
      type: 'answer',
      sdp: 'v=0 fake-answer',
      sessionId: 'sess-1',
      sessionToken: 'tok-1',
    });
  });

  test('the peer connection is built with the base STUN plus the session ice servers', async () => {
    const { socket } = startAndOpen();
    socket.serverSays(PEER);
    socket.serverSays({ type: 'offer', sessionId: 'sess-1', sdp: 'v=0 offer' });
    await flush();

    const pc = FakePeerConnection.instances[FakePeerConnection.instances.length - 1];
    expect(pc.config.iceServers).toEqual(
      expect.arrayContaining([{ urls: ['turn:t.test:3478'], username: 'u', credential: 'c' }]),
    );
  });

  test('an incoming video track surfaces a stream and marks the receiver casting', async () => {
    const { socket, callbacks } = startAndOpen();
    socket.serverSays(PEER);
    socket.serverSays({ type: 'offer', sessionId: 'sess-1', sdp: 'v=0 offer' });
    await flush();
    const pc = FakePeerConnection.instances[FakePeerConnection.instances.length - 1];

    pc.fireTrack('video');

    expect(callbacks.onVideoTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'stream-1' }),
    );
    expect(callbacks.onCasting).toHaveBeenCalledWith(true);
  });
});

describe('ICE candidates', () => {
  test('remote ICE arriving before the offer is buffered then flushed after setRemoteDescription', async () => {
    const { socket } = startAndOpen();
    socket.serverSays(PEER);

    socket.serverSays({
      type: 'ice',
      sessionId: 'sess-1',
      candidate: { candidate: 'cand-early', sdpMid: '0', sdpMLineIndex: 0 },
    });
    socket.serverSays({ type: 'offer', sessionId: 'sess-1', sdp: 'v=0 offer' });
    await flush();

    const pc = FakePeerConnection.instances[FakePeerConnection.instances.length - 1];
    expect(pc.addedCandidates).toEqual([expect.objectContaining({ candidate: 'cand-early' })]);
  });

  test('a local ICE candidate is relayed stamped with the session ids', async () => {
    const { socket } = startAndOpen();
    socket.serverSays(PEER);
    socket.serverSays({ type: 'offer', sessionId: 'sess-1', sdp: 'v=0 offer' });
    await flush();
    const pc = FakePeerConnection.instances[FakePeerConnection.instances.length - 1];

    pc.onicecandidate({ candidate: { candidate: 'cand-local', sdpMid: '0', sdpMLineIndex: 0 } });

    expect(socket.sent).toContainEqual({
      type: 'ice',
      candidate: { candidate: 'cand-local', sdpMid: '0', sdpMLineIndex: 0 },
      sessionId: 'sess-1',
      sessionToken: 'tok-1',
    });
  });
});

describe('resilience', () => {
  test('ICE failed sends a restart (never a bye)', async () => {
    const { socket } = startAndOpen();
    socket.serverSays(PEER);
    socket.serverSays({ type: 'offer', sessionId: 'sess-1', sdp: 'v=0 offer' });
    await flush();
    const pc = FakePeerConnection.instances[FakePeerConnection.instances.length - 1];

    pc.fireIceState('failed');

    expect(socket.sent).toContainEqual(
      expect.objectContaining({ type: 'restart', reason: 'ice failed', sessionId: 'sess-1' }),
    );
    expect(socket.sent.some((m) => m.type === 'bye')).toBe(false);
  });

  test('a bye from the server resets the session to idle', async () => {
    const { socket, callbacks } = startAndOpen();
    socket.serverSays(PEER);
    socket.serverSays({ type: 'offer', sessionId: 'sess-1', sdp: 'v=0 offer' });
    await flush();

    socket.serverSays({ type: 'bye', sessionId: 'sess-1' });

    expect(callbacks.onVideoTrack).toHaveBeenLastCalledWith(null);
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('ready to receive');
  });

  test('a room carrying a live session while we have none re-adopts the ids and reports ready', () => {
    const { socket, callbacks } = startAndOpen();

    socket.serverSays({
      type: 'room',
      room: { code: 'ABC12', displayPin: '111111' },
      session: { sessionId: 'sess-2', sessionToken: 'tok-2' },
    });

    expect(callbacks.onStatus).toHaveBeenLastCalledWith('ready to receive');
  });

  test('after grace re-adopt, an offer for the adopted session is answered with those ids', async () => {
    const { socket } = startAndOpen();
    // Re-adopt session ids from a room carrying them (no peer message yet)...
    socket.serverSays({
      type: 'room',
      room: { code: 'ABC12', displayPin: '111111' },
      session: { sessionId: 'sess-2', sessionToken: 'tok-2' },
    });
    // ...then the sender's peer + offer rebuilds media on the same session.
    socket.serverSays({ ...PEER, sessionId: 'sess-2', sessionToken: 'tok-2' });
    socket.serverSays({ type: 'offer', sessionId: 'sess-2', sdp: 'v=0 offer' });
    await flush();

    expect(socket.sent).toContainEqual(
      expect.objectContaining({ type: 'answer', sessionId: 'sess-2', sessionToken: 'tok-2' }),
    );
  });
});

describe('preemption', () => {
  test('a new peer with a different sessionId adopts the new session', async () => {
    const { socket } = startAndOpen();
    socket.serverSays(PEER);
    socket.serverSays({ type: 'offer', sessionId: 'sess-1', sdp: 'v=0 offer' });
    await flush();

    socket.serverSays({ ...PEER, sessionId: 'sess-2', sessionToken: 'tok-2' });
    socket.serverSays({ type: 'offer', sessionId: 'sess-2', sdp: 'v=0 offer-2' });
    await flush();

    expect(socket.sent).toContainEqual(
      expect.objectContaining({ type: 'answer', sessionId: 'sess-2', sessionToken: 'tok-2' }),
    );
  });
});
