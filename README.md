# bw-remote-controller-poc

Proof of concept for BirdAI remote control over a **WebRTC DataChannel**: a web
touchpad drives a panel peer-to-peer (Cloudflare TURN when P2P is impossible),
signaled by the existing **cymcast** service, while pairing and presence stay on
**bird-ai-server**. One web app, two roles, two browser tabs.

Plan and background: Notion → *Remote Control POC: Plan*, *Remote Control: Jitter
Analysis, Cloudflare Options and Best Practices* (section 4.5, HZ-P2P).

## What it proves

| # | Claim | Status |
|---|---|---|
| 1 | Production pairing flow (Room ID, PIN, `PAIR_DEVICE`, `PAIR_SUCCESSFUL`) works with the simulator panel and a ported web room | done |
| 2 | A control session opens through **production cymcast** with the **existing cast grant** and **no server change** | done |
| 3 | Pointer and keys over the DataChannel are smoother than today's socket path | done, see `docs/results.md` |
| 4 | Forced Cloudflare TURN relay works and is measured | done |
| 5 | Fallback to the socket path when the channel does not open | unit-tested (`control-sender.test.js`); live run pending |
| 6 | Behaviour under impairment (latency + loss) | procedure in `docs/results.md`; run pending |

## Run

```bash
nvm use 22
npm install
cp .env.example .env.local      # production pair prefilled; dev pair commented
npm run dev                     # http://localhost:5173
```

Open two tabs:

- `http://localhost:5173/?role=panel` → set a recognisable device name, **Go live** (v3 token mode, no secret). Note the Room ID.
- `http://localhost:5173/?role=web-room` → enter the Room ID → **Request PIN** → read the PIN on the panel tab → **Pair** → **Room Control**.

In the dialog: move the mouse, click, scroll, type; **Run 60 s gesture script** for a
repeatable run. On the page: switch **Input path** (DataChannel vs socket), tick
**force TURN relay** before starting, **Export JSON** for the numbers.

Production hygiene: the panel registers a *simulated* device in production (not linked
to any workspace). End every run with **Unpair** and **Stop device**.

## Environment pairs (never mix)

The cast grant is signed by bird-ai-server and verified by cymcast with a shared secret
per environment.

| env | bird-ai-server | cymcast |
|---|---|---|
| production (default) | `https://ubs-server.birdai.com` | `https://cymcast.birdai.com` |
| development | `https://ubs-server-dev.birdai.com` | `https://cymcast-dev.birdai.com` |

## Layout

```
src/
  App.jsx, shared/role.js          role selector (role pinned in the URL, never localStorage)
  shared/protocol/                 pointer-frame (16-byte binary codec), control-messages (JSON)
  shared/metrics/                  stats (p50/p95/jitter), latency-probe
  roles/panel/                     PanelRole, control-receiver, v1-apply (socket path), CursorCanvas
  roles/web-room/                  WebRoomRole, use-anonymous-session, use-pairing, use-control-session,
                                   control-sender (cymcast signaling + DataChannels + recovery),
                                   input-pipeline (AW2 design), sinks (datachannel | socket v1),
                                   RemoteDialog, MetricsPanel, gesture-script, bird-api
  vendor/simulator/                device simulator cores from scripts/browser-based-simulator
                                   (+ POC extensions: onDataChannel, onRemoteControl, sendMeetingCommand,
                                   version-aware isConfigReady), with their original tests
docs/results.md                    measured runs and the pending test procedures
```

## Planes

- **Control plane** (unchanged): socket.io to bird-ai-server. Presence, pairing, `REMOTE_START` / `REMOTE_STOP`.
- **Signaling plane** (unchanged protocol): cymcast WebSocket. `connect` with the cast grant, `peer`, `offer`, `answer`, `ice`, `bye`, `restart`, `resume`.
- **Input plane** (new): two DataChannels. `pointer` is unordered with `maxRetransmits: 0` (latest wins); `control` is reliable and ordered (buttons, keys, acks, probes).

The socket path (comparison mode) reuses the same input pipeline with a sink that emits
today's v1 `REMOTE_CONTROL` payloads; the panel acks and answers probes via `MEETING_COMMAND`.

## Tests

```bash
npm test          # vitest: 206 tests (pure modules + vendored characterization suites)
npm run lint
npm run build
```

## Known limitations of the POC

- One cymcast session per panel: a control session occupies the cast slot (production: add a session `kind`).
- `CAST_SEND` grant reused for control (production: a `CONTROL_SEND` action).
- Two tabs on one machine give a `host` pair on localhost; the relay and impairment runs are the meaningful network numbers.
- Production bird-ai-server unpairs on any web-socket disconnect (issue P6); a page reload in the web room tab therefore requires re-pairing.
