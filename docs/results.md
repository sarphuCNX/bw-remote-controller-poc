# Results

Machine: one laptop, two tabs (Chromium via Playwright), production pair
(`ubs-server.birdai.com` + `cymcast.birdai.com`). Date: 2026-10-07.
Panel: simulated device "POC Simulated Room", Room ID `PABZK`, v3 token registration.

All runs use the 60 s scripted gesture set (circle, drag, scroll, key bursts), sampled
after 15–20 s. RTT = probe round trip on the active path (web → panel → web).
`events/s` counts pipeline sends since session start, so it dips when the script
starts late in a session.

## Run 1 — DataChannel, direct (host pair)

| metric | value |
|---|---|
| ICE pair | host |
| probe RTT p50 / p95 | **1.3 / 6.9 ms** |
| RTT jitter | 2.7 ms |
| ack RTT p50 / p95 (discrete events) | 1.2 / 3.9 ms |
| ICE RTT (getStats) | 2.0 ms |
| panel: pointer frames / lost / discrete | 1452 / **0** / 80, sequence numbers contiguous, down/up pairs intact |

Screenshot: `screenshots/poc-panel-datachannel.png`

## Run 2 — Socket path through production (today's path)

| metric | value |
|---|---|
| probe RTT p50 / p95 | **644.5 / 708.8 ms** |
| RTT jitter | 41.0 ms |
| panel log | `MOUSE_DOWN`, `MOUSE_UP`, `KEYBOARD_PRESS` arrive; no ack path exists in v1 |

Note: the socket probe round trip is web → bird-ai-server (Germany) → device socket →
panel → `MEETING_COMMAND` → bird-ai-server → web, i.e. two server hops plus the per-event
server work described in the Current Implementation doc. It is the real production path
from this location.

Screenshots: `screenshots/poc-webroom-socket-run.png`, `screenshots/poc-panel-socket-run.png`

## Run 3 — DataChannel, forced Cloudflare TURN relay

| metric | value |
|---|---|
| ICE pair | relay |
| probe RTT p50 / p95 | **136.1 / 219.6 ms** |
| RTT jitter | 24.9 ms |
| ack RTT p50 / p95 | 144.5 / 211.0 ms |
| ICE RTT (getStats) | 198 ms |
| loss | 0 |

Screenshot: `screenshots/poc-webroom-relay-run.png`

## Summary

| path | RTT p50 | RTT p95 | jitter |
|---|---|---|---|
| DataChannel direct | 1.3 ms | 6.9 ms | 2.7 ms |
| DataChannel via Cloudflare TURN | 136 ms | 220 ms | 25 ms |
| Socket via production bird-ai-server | 645 ms | 709 ms | 41 ms |

Even the relayed DataChannel is about 4.7x faster than today's socket path at p50 and
3.2x at p95, with lower jitter; the direct path is three orders of magnitude faster.

## Pending runs

### Run 4/5 — impairment (150 ms latency, 2 percent loss)

macOS Network Link Conditioner (Additional Tools for Xcode): create a profile with
150 ms downlink/uplink delay and 2 percent packet loss on both. Enable it, repeat Run 1
and Run 2 with the gesture script, record the same table, then disable it. Chrome
DevTools throttling only affects HTTP/WebSocket, not WebRTC, so it is unsuitable for
the DataChannel path.

Expected: the DataChannel path keeps a flat trail with occasional dropped pointer
frames (`lost` grows, no bursts); the socket path shows burst-then-jump as TCP
retransmits.

### Run 6 — signaling blip

With a DataChannel session live, block `cymcast.birdai.com` for 10 s (for example a
hosts-file edit or a firewall rule) and unblock. Expected: input keeps flowing; the
log shows `signaling reconnecting` then `signaling resumed`.

### Run 7 — channel blocked (fallback)

Block UDP and TURN (or block `cymcast.birdai.com` before starting). Expected: after
5 s the log shows `datachannel closed: open-timeout` then `input path: socket (fallback
after open-timeout)`; input continues over the socket.

## Issues found during the runs

- The web room tab unpairs if it reloads (production bird-ai-server unpairs on web-socket
  disconnect, issue P6). Not a POC bug; the POC's REST status check on reconnect makes
  the UI reflect it immediately.
- The gesture-script control was unreachable under the full-page dialog; moved into the
  dialog header. Closing a session now cancels a running script.
