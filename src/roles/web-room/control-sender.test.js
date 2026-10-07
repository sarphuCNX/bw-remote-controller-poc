import { buildSignalingUrl, createControlSender, readSelectedPair } from './control-sender';

/**
 * Fake WebSocket: records sent frames, lets the test drive open/message/close.
 * @returns {function} a constructor whose instances are collected on `sockets`
 */
function createFakeWebSocket() {
  const sockets = [];
  function FakeWebSocket(url) {
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    this.send = (text) => this.sent.push(JSON.parse(text));
    this.close = () => {
      this.readyState = 3;
    };
    sockets.push(this);
  }
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.sockets = sockets;
  return FakeWebSocket;
}

/**
 * Fake RTCPeerConnection with scripted data channels.
 * @returns {function(object): object} a factory collecting instances on `pcs`
 */
function createFakePeerConnectionFactory() {
  const pcs = [];
  const factory = (config) => {
    const channels = {};
    const pc = {
      config,
      remoteDescription: null,
      localDescription: null,
      connectionState: 'new',
      offers: [],
      candidates: [],
      closed: false,
      createDataChannel: (label, options) => {
        const channel = { label, options, readyState: 'connecting', sent: [], send: (d) => channel.sent.push(d) };
        channels[label] = channel;
        return channel;
      },
      createOffer: async (options) => {
        pc.offers.push(options || null);
        return { type: 'offer', sdp: `offer-${pc.offers.length}` };
      },
      setLocalDescription: async (desc) => {
        pc.localDescription = desc;
      },
      setRemoteDescription: async (desc) => {
        pc.remoteDescription = desc;
      },
      addIceCandidate: async (c) => {
        pc.candidates.push(c);
      },
      close: () => {
        pc.closed = true;
      },
      getStats: async () => new Map(),
      channels,
    };
    pcs.push(pc);
    return pc;
  };
  factory.pcs = pcs;
  return factory;
}

/**
 * Builds a sender with fakes and manual timers.
 * @param {object} [overrides] - option overrides
 * @returns {object} the harness
 */
function createHarness(overrides = {}) {
  const FakeWebSocket = createFakeWebSocket();
  const pcFactory = createFakePeerConnectionFactory();
  const timers = [];
  const events = { phases: [], closed: [], closedInfo: [], errors: [], channels: [], pairs: [] };
  const sender = createControlSender({
    cymcastUrl: 'https://cymcast.test',
    getGrant: async () => 'grant-1',
    webSocketFactory: FakeWebSocket,
    peerConnectionFactory: pcFactory,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].cancelled = true;
    },
    setInterval: () => 99,
    clearInterval: () => {},
    callbacks: {
      onPhase: (p) => events.phases.push(p),
      onClosed: (r, info) => {
        events.closed.push(r);
        events.closedInfo.push(info);
      },
      onError: (c) => events.errors.push(c),
      onChannels: (c) => events.channels.push(c),
      onPair: (p) => events.pairs.push(p),
    },
    ...overrides,
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { sender, FakeWebSocket, pcFactory, timers, events, flush };
}

/**
 * Drives a sender to the point where the panel peer arrived and the offer was sent.
 * @param {object} harness - from createHarness
 * @returns {Promise<{socket: object, pc: object}>} the live socket and peer connection
 */
async function connectToPeer(harness) {
  harness.sender.start();
  await harness.flush();
  const socket = harness.FakeWebSocket.sockets[0];
  socket.onopen();
  await harness.flush();
  socket.onmessage({
    data: JSON.stringify({
      type: 'peer',
      peer: 'panel',
      sessionId: 's1',
      sessionToken: 't1',
      iceServers: [{ urls: 'turn:relay.test', username: 'u', credential: 'c' }],
    }),
  });
  await harness.flush();
  return { socket, pc: harness.pcFactory.pcs[0] };
}

describe('buildSignalingUrl', () => {
  test('buildSignalingUrl_withHttps_returnsWssWsPath', () => {
    expect(buildSignalingUrl('https://cymcast.birdai.com/')).toBe('wss://cymcast.birdai.com/ws');
  });

  test('buildSignalingUrl_withNonHttp_throws', () => {
    expect(() => buildSignalingUrl('ftp://x')).toThrow(/http/);
  });
});

describe('readSelectedPair', () => {
  test('readSelectedPair_withNominatedRelayPair_returnsRelayAndRtt', () => {
    const report = new Map([
      ['p1', { id: 'p1', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l1', remoteCandidateId: 'r1', currentRoundTripTime: 0.021 }],
      ['l1', { id: 'l1', type: 'local-candidate', candidateType: 'relay' }],
      ['r1', { id: 'r1', type: 'remote-candidate', candidateType: 'host' }],
    ]);

    expect(readSelectedPair(report)).toEqual({ pairType: 'relay', rttMs: 21 });
  });

  test('readSelectedPair_withNoNominatedPair_returnsEmpty', () => {
    expect(readSelectedPair(new Map())).toEqual({ pairType: '', rttMs: null });
  });
});

describe('createControlSender happy path', () => {
  test('start_sendsConnectWithGrantOnOpen', async () => {
    const h = createHarness();

    h.sender.start();
    await h.flush();
    const socket = h.FakeWebSocket.sockets[0];
    socket.onopen();
    await h.flush();

    expect(socket.url).toBe('wss://cymcast.test/ws');
    expect(socket.sent[0]).toEqual({ type: 'connect', token: 'grant-1' });
    expect(h.sender.getState().phase).toBe('signaling');
  });

  test('peer_createsPcWithServerIceServersAndTwoChannelsAndOffers', async () => {
    const h = createHarness();

    const { socket, pc } = await connectToPeer(h);

    expect(pc.config.iceTransportPolicy).toBe('all');
    expect(pc.config.iceServers.some((s) => String(s.urls).startsWith('turn:'))).toBe(true);
    expect(pc.channels.pointer.options).toEqual({ ordered: false, maxRetransmits: 0 });
    expect(pc.channels.control.options).toBeUndefined();
    expect(socket.sent[1]).toEqual({ type: 'offer', sdp: 'offer-1', sessionId: 's1', sessionToken: 't1' });
  });

  test('answer_setsRemoteDescriptionAndFlushesBufferedCandidates', async () => {
    const h = createHarness();
    const { socket, pc } = await connectToPeer(h);
    socket.onmessage({ data: JSON.stringify({ type: 'ice', candidate: { candidate: 'cand-early', sdpMid: '0', sdpMLineIndex: 0 } }) });

    socket.onmessage({ data: JSON.stringify({ type: 'answer', sdp: 'answer-sdp' }) });
    await h.flush();

    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' });
    expect(pc.candidates).toEqual([{ candidate: 'cand-early', sdpMid: '0', sdpMLineIndex: 0 }]);
  });

  test('bothChannelsOpen_setsReadySendsHelloAndReportsChannels', async () => {
    const h = createHarness();
    const { pc } = await connectToPeer(h);

    pc.channels.pointer.readyState = 'open';
    pc.channels.pointer.onopen();
    pc.channels.control.readyState = 'open';
    pc.channels.control.onopen();

    expect(h.sender.getState().phase).toBe('ready');
    expect(JSON.parse(pc.channels.control.sent[0])).toEqual({ t: 'hello', role: 'controller' });
    expect(h.events.channels).toHaveLength(1);
  });

  test('localIceCandidate_isRelayedWithSessionBinding', async () => {
    const h = createHarness();
    const { socket, pc } = await connectToPeer(h);

    pc.onicecandidate({ candidate: { candidate: 'cand-1', sdpMid: '0', sdpMLineIndex: 0 } });

    expect(socket.sent[2]).toEqual({
      type: 'ice',
      candidate: { candidate: 'cand-1', sdpMid: '0', sdpMLineIndex: 0 },
      sessionId: 's1',
      sessionToken: 't1',
    });
  });

  test('forceRelay_pinsIceTransportPolicyToRelay', async () => {
    const h = createHarness({ forceRelay: true });

    const { pc } = await connectToPeer(h);

    expect(pc.config.iceTransportPolicy).toBe('relay');
  });
});

describe('createControlSender failure and recovery', () => {
  test('deadline_whenNoPeerArrivesAfterConnect_closesWithOpenTimeout', async () => {
    const h = createHarness();
    h.sender.start();
    await h.flush();
    h.FakeWebSocket.sockets[0].onopen();
    await h.flush();

    const deadline = h.timers.filter((t) => t.ms === 5000 && !t.cancelled).pop();
    deadline.fn();

    expect(h.events.closed).toEqual(['open-timeout']);
  });

  test('rungOneDeadline_withoutReconnect_escalatesToRelayRebuild', async () => {
    const h = createHarness();
    const { pc } = await connectToPeer(h);
    pc.connectionState = 'failed';
    pc.onconnectionstatechange();
    await h.flush();

    const rungDeadline = h.timers.filter((t) => t.ms === 5000 && !t.cancelled).pop();
    rungDeadline.fn();

    expect(h.sender.getState()).toMatchObject({ phase: 'recovering', rung: 2 });
    expect(h.pcFactory.pcs[1].config.iceTransportPolicy).toBe('relay');
  });

  test('openTimeout_whileConnecting_closesWithOpenTimeout', async () => {
    const h = createHarness();
    await connectToPeer(h);

    const liveDeadline = h.timers.filter((t) => t.ms === 5000 && !t.cancelled).pop();
    liveDeadline.fn();

    expect(h.events.closed).toEqual(['open-timeout']);
    expect(h.sender.getState().phase).toBe('closed');
  });

  test('rungOneRestartSucceeds_returnsToReadyAndCancelsDeadline', async () => {
    const h = createHarness();
    const { pc } = await connectToPeer(h);
    pc.channels.pointer.readyState = 'open';
    pc.channels.pointer.onopen();
    pc.channels.control.readyState = 'open';
    pc.channels.control.onopen();
    pc.connectionState = 'failed';
    pc.onconnectionstatechange();
    await h.flush();
    expect(h.sender.getState().phase).toBe('recovering');

    pc.connectionState = 'connected';
    pc.onconnectionstatechange();

    expect(h.sender.getState()).toMatchObject({ phase: 'ready', rung: 0 });
    expect(h.timers.filter((t) => t.ms === 5000).every((t) => t.cancelled)).toBe(true);
  });

  test('grantResolvesAfterDeadlineClosed_doesNotReopenTheSender', async () => {
    let resolveGrant;
    const h = createHarness({ getGrant: () => new Promise((resolve) => (resolveGrant = resolve)) });
    h.sender.start();
    await h.flush();
    h.FakeWebSocket.sockets[0].onopen();
    await h.flush();
    h.timers.filter((t) => t.ms === 5000 && !t.cancelled).pop().fn();
    expect(h.events.closed).toEqual(['open-timeout']);
    const phasesAfterClose = h.events.phases.length;

    resolveGrant('late-grant');
    await h.flush();

    expect(h.sender.getState().phase).toBe('closed');
    expect(h.events.phases.length).toBe(phasesAfterClose);
  });

  test('connectionFailed_firstTime_reoffersWithIceRestart', async () => {
    const h = createHarness();
    const { pc } = await connectToPeer(h);

    pc.connectionState = 'failed';
    pc.onconnectionstatechange();
    await h.flush();

    expect(h.sender.getState()).toMatchObject({ phase: 'recovering', rung: 1 });
    expect(pc.offers[1]).toEqual({ iceRestart: true });
  });

  test('connectionFailed_secondTime_rebuildsRelayOnlyPeerConnection', async () => {
    const h = createHarness();
    const { pc } = await connectToPeer(h);
    pc.connectionState = 'failed';
    pc.onconnectionstatechange();
    await h.flush();

    pc.connectionState = 'failed';
    pc.onconnectionstatechange();
    await h.flush();

    expect(h.pcFactory.pcs).toHaveLength(2);
    expect(h.pcFactory.pcs[1].config.iceTransportPolicy).toBe('relay');
    expect(pc.closed).toBe(true);
  });

  test('connectionFailed_thirdTime_closesWithFailed', async () => {
    const h = createHarness();
    const { pc } = await connectToPeer(h);
    for (let i = 0; i < 2; i += 1) {
      const current = h.pcFactory.pcs[h.pcFactory.pcs.length - 1] || pc;
      current.connectionState = 'failed';
      current.onconnectionstatechange();
      await h.flush();
    }

    const last = h.pcFactory.pcs[h.pcFactory.pcs.length - 1];
    last.connectionState = 'failed';
    last.onconnectionstatechange();

    expect(h.events.closed).toEqual(['failed']);
  });

  test('grantDeniedError_closesWithThatCode', async () => {
    const h = createHarness();
    h.sender.start();
    await h.flush();
    const socket = h.FakeWebSocket.sockets[0];
    socket.onopen();
    await h.flush();

    socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'grant-denied', message: 'no' }) });

    expect(h.events.errors).toEqual(['grant-denied']);
    expect(h.events.closed).toEqual(['grant-denied']);
  });

  test('grantDeniedError_isReportedAsTerminal', async () => {
    const h = createHarness();
    h.sender.start();
    await h.flush();
    const socket = h.FakeWebSocket.sockets[0];
    socket.onopen();
    await h.flush();

    socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'room-busy', message: 'busy' }) });

    expect(h.events.closedInfo).toEqual([{ terminal: true, userStop: false }]);
  });

  test('nonTerminalError_doesNotClose', async () => {
    const h = createHarness();
    h.sender.start();
    await h.flush();
    const socket = h.FakeWebSocket.sockets[0];
    socket.onopen();
    await h.flush();

    socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'rate-limited', message: 'slow down' }) });

    expect(h.events.errors).toEqual(['rate-limited']);
    expect(h.events.closed).toHaveLength(0);
  });

  test('openTimeout_isReportedAsNotTerminal', async () => {
    const h = createHarness();
    h.sender.start();
    await h.flush();
    h.FakeWebSocket.sockets[0].onopen();
    await h.flush();

    const deadline = h.timers.filter((t) => t.ms === 5000 && !t.cancelled).pop();
    deadline.fn();

    expect(h.events.closedInfo).toEqual([{ terminal: false, userStop: false }]);
  });

  test('connectionFailed_thirdTime_isReportedAsNotTerminal', async () => {
    const h = createHarness();
    const { pc } = await connectToPeer(h);
    for (let i = 0; i < 3; i += 1) {
      const current = h.pcFactory.pcs[h.pcFactory.pcs.length - 1] || pc;
      current.connectionState = 'failed';
      current.onconnectionstatechange();
      await h.flush();
    }

    expect(h.events.closed).toEqual(['failed']);
    expect(h.events.closedInfo).toEqual([{ terminal: false, userStop: false }]);
  });

  test('getGrantRejects_closesWithGrantFailed', async () => {
    const h = createHarness({ getGrant: async () => { throw new Error('nope'); } });
    h.sender.start();
    await h.flush();

    h.FakeWebSocket.sockets[0].onopen();
    await h.flush();

    expect(h.events.closed).toEqual(['grant-failed']);
    expect(h.events.closedInfo).toEqual([{ terminal: true, userStop: false }]);
  });

  test('signalingClose_withLiveSession_reconnectsAndResumes', async () => {
    const h = createHarness();
    const { socket } = await connectToPeer(h);

    socket.onclose();
    const reconnect = h.timers.find((t) => t.ms === 1000);
    reconnect.fn();
    await h.flush();
    const resumed = h.FakeWebSocket.sockets[1];
    resumed.onopen();

    expect(resumed.sent[0]).toEqual({ type: 'resume', sessionId: 's1', sessionToken: 't1' });
    expect(h.events.closed).toHaveLength(0);
  });

  test('byeFromPanel_closesWithBye', async () => {
    const h = createHarness();
    const { socket } = await connectToPeer(h);

    socket.onmessage({ data: JSON.stringify({ type: 'bye', sessionId: 's1' }) });

    expect(h.events.closed).toEqual(['bye']);
    expect(h.events.closedInfo).toEqual([{ terminal: true, userStop: false }]);
  });

  test('byeWithPreemptedReason_closesWithPreemptedAsTerminal', async () => {
    const h = createHarness();
    const { socket } = await connectToPeer(h);

    socket.onmessage({ data: JSON.stringify({ type: 'bye', sessionId: 's1', reason: 'preempted' }) });

    expect(h.events.closed).toEqual(['preempted']);
    expect(h.events.closedInfo).toEqual([{ terminal: true, userStop: false }]);
  });

  test('restartFromPanel_reoffersWithIceRestart', async () => {
    const h = createHarness();
    const { socket, pc } = await connectToPeer(h);

    socket.onmessage({ data: JSON.stringify({ type: 'restart', reason: 'ice disconnected' }) });
    await h.flush();

    expect(pc.offers[1]).toEqual({ iceRestart: true });
  });

  test('stop_sendsByeWithSessionAndCloses', async () => {
    const h = createHarness();
    const { socket } = await connectToPeer(h);

    h.sender.stop();

    expect(socket.sent[socket.sent.length - 1]).toEqual({ type: 'bye', sessionId: 's1', sessionToken: 't1' });
    expect(h.events.closed).toEqual(['stopped']);
  });

  test('stop_isReportedAsTerminalUserStop', async () => {
    const h = createHarness();
    await connectToPeer(h);

    h.sender.stop();

    expect(h.events.closedInfo).toEqual([{ terminal: true, userStop: true }]);
  });

  test('start_afterClose_opensFreshSignalingFromIdle', async () => {
    const h = createHarness();
    h.sender.start();
    await h.flush();
    h.FakeWebSocket.sockets[0].onopen();
    await h.flush();
    h.timers.filter((t) => t.ms === 5000 && !t.cancelled).pop().fn();
    expect(h.events.closed).toEqual(['open-timeout']);

    h.sender.start();
    await h.flush();
    const second = h.FakeWebSocket.sockets[1];
    second.onopen();
    await h.flush();

    expect(second.sent[0]).toEqual({ type: 'connect', token: 'grant-1' });
    expect(h.sender.getState()).toMatchObject({ phase: 'signaling', rung: 0 });
  });

  test('start_afterStop_reachesReadyAgainAndReportsASecondClose', async () => {
    const h = createHarness();
    await connectToPeer(h);
    h.sender.stop();

    h.sender.start();
    await h.flush();
    const second = h.FakeWebSocket.sockets[1];
    second.onopen();
    await h.flush();
    second.onmessage({ data: JSON.stringify({ type: 'bye', sessionId: 's2' }) });

    expect(h.events.closed).toEqual(['stopped', 'bye']);
  });
});
