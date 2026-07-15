# stdout-backpressure event-loop wedge — RED repro

Faithful local reproduction of the production hang where the
`claude-sdk-python` showcase integration's public HTTP server (Next.js on
`$PORT`) silently wedged: `GET /api/health` went from fast-200 to 502/timeout,
CPU dropped to 0, memory stayed flat, the process stayed RUNNING, and Railway
never restarted it.

This directory is **RED only** — it observes the bug. It applies no fix.

## Run it

```
tests/repro/stdout-wedge/run.sh
```

That runs the whole topology on **real Linux** via Docker (`node:22-slim`),
prints a timestamped transcript, and saves it to `/tmp/stdout-wedge-red.txt`.
Docker is required for a faithful result (see Faithfulness below); no other
setup is needed.

Knobs (env vars, all optional): `CAP` (reader lines/tick, default 50),
`TICK` (reader tick ms, default 1000), `FLOOD_START_DELAY_MS` (warm-up before
the flood, default 5000), `POLLS`, `POLL_INTERVAL`, `IMAGE`.

## The bug (proven root cause)

Production `integrations/claude-sdk-python/entrypoint.sh` runs BOTH processes
with stdout/stderr redirected through a bash process substitution:

- `entrypoint.sh:39` — Python agent: `python -u -m uvicorn ... &> >(awk '{print "[agent] " $0; fflush()}')`
- `entrypoint.sh:58` — Next.js: `env NODE_ENV=production npx next start --port $PORT &> >(awk '{print "[nextjs] " $0; fflush()}')`

Each process's `fd1` is therefore a **pipe**. On the Linux container, a pipe
stdout is a **synchronous/blocking** fd: `console.log` → `process.stdout.write`
→ a blocking `write(2)`. Downstream, Railway drains the container stdout at a
capped rate (~500 logs/sec — the incident showed "Messages dropped: 122").

Under a D6 burst the flood (uvicorn access-log-per-request +
per-LLM-call CVDIAG `outbound-llm` breadcrumb at
`src/agents/_header_forwarding.py:87`, line-flushed by `PYTHONUNBUFFERED=1` /
`python -u`) crosses that cap. Railway stops draining → the awk pipe fills →
the next `console.log`/write blocks in `write(2)` → the **single event loop
freezes**. Even the trivial static `GET /api/health`
(`src/app/api/health/route.ts`, no upstream, no logging on its path) can no
longer be served → 502/timeout. CPU → 0 (parked in the syscall, not spinning),
memory flat (no allocation), process resident. Railway's
`restartPolicyType: ON_FAILURE` never fires (no exit); the agent-only watchdog
is satisfied (`entrypoint.sh:80-104`). Indefinite wedge.

## Topology of the repro

```
server.mjs  (single Node event loop, fd1 = BLOCKING pipe)
  |   models next start on $PORT: a static /health route + a log flood
  |
  |  > >(awk '{print "[nextjs] " $0; fflush()}')   <-- identical to entrypoint.sh:58
  v
awk   (line-prefix + fflush, the real wrapper)
  |
  v
reader.mjs   (drains only CAP lines per TICK — models Railway's ~500/sec cap)
```

- **`server.mjs`** — one event loop (like Next.js). `GET /health` is static with
  **no logging on its path** (mirrors the real route), so a timeout there proves
  an event-loop-WIDE stall, not one slow handler. A background `setInterval`
  emits the flood via `console.log`, mirroring the real uvicorn access line +
  CVDIAG `outbound-llm` breadcrumb shape and volume. A 5s warm-up delays the
  flood so the transcript captures the clean **fast-200 → wedge** transition.
- **`reader.mjs`** — the throttled downstream consumer standing in for Railway's
  drain cap.
- **`run.sh`** — launches the pipeline, polls `/health`, and samples
  `state`/`cpu_jiffies`/`rss` from `/proc` to show CPU→0 + resident + flat mem.

## RED evidence (representative run)

```
18:19:56  health=[200 time=0.001753s] | state=S cpu_jiffies=0 | warm-up (no flood)
18:19:59  health=[200 time=0.000894s] | state=S cpu_jiffies=0 | warm-up
18:20:00  health=[200 time=0.000499s] | state=S cpu_jiffies=1 | FLOOD START
18:20:01  health=[WEDGE(curl_timeout)] | state=S cpu_jiffies=1 | flood tick n=1000
18:20:05  health=[WEDGE(curl_timeout)] | state=S cpu_jiffies=1 | flood tick n=1500
...        (sustained timeout; cpu_jiffies barely moves 1->2 over 40s)
18:20:41  health=[WEDGE(curl_timeout)] | state=S cpu_jiffies=2 | flood tick n=6500
```

Matches the production signature point-for-point: fast-200 → timeout, CPU flat
at ~0 (parked in `write(2)`, not spinning), RSS flat (no OOM), process resident
(`state=S`), and the flood-tick heartbeat freezing confirms the _event loop_
stalled — not just HTTP.

## Faithfulness — read this

**What is fully faithful:** the entire load-bearing mechanism — a single event
loop whose `fd1` is a pipe through the _identical_ `awk '{...; fflush()}'`
process substitution from `entrypoint.sh`, a downstream reader capped like
Railway, a flood shaped/sized like the real uvicorn + CVDIAG output, and a
static no-log health route as the victim. It runs on **real Linux** (Docker),
the production OS, so the pipe/`write(2)` blocking semantics are the real ones.
The observed failure — fast-200 → timeout, CPU→0, mem-flat, resident — is the
production signature.

**The one thing made explicit rather than implicit:** `server.mjs` calls
`process.stdout._handle.setBlocking(true)`. This is _not_ a cheat — it is the
exact mode Node uses for a blocking pipe stdout, and it is what makes the
`write(2)` synchronous (the production condition the diagnosis proves). It is
set explicitly because **modern Node (v22/v25) defaults a pipe stdout to an
async `Socket`** that buffers writes in userspace instead of blocking. Without
`setBlocking(true)`, on these Node versions the same flood does **not** freeze
the loop — instead `writableLength` grows unbounded (verified: 4.7MB → 15MB+
and climbing) heading toward OOM, which is a _different_ failure mode and does
not match the incident's flat-memory + CPU-0 signature. Setting blocking mode
reproduces the incident's actual mechanism deterministically. (On the Python
side of the real container, `sys.stdout.write` under `python -u` is _natively_
a blocking `write(2)` with no async buffering — so the synchronous-blocking
condition is unavoidably real there; `setBlocking(true)` brings the Node model
to the same footing the diagnosis attributes to the container's Node process.)

**Compromise:** this harness uses a plain Node `http` server rather than a full
`next build && next start`. A real Next build was skipped to keep the repro fast
and hermetic; the event-loop + pipe-stdout + static-route mechanism is identical
either way (Next.js _is_ a single Node event loop), so the substitution does not
affect what is being proven. Run `RUNNER=local ./run.sh` to run on the host
(e.g. macOS) — note macOS pipe stdout is async, so `setBlocking(true)` is still
required and behavior may differ from Linux; **Docker is the faithful path.**

## GREEN counterparts (the fixes, proven)

Two fixes landed on `fix/showcase-stdout-backpressure-wedge`; this directory
now exercises both. The fix files themselves
(`integrations/_shared/cvdiag_bootstrap.py`,
`integrations/claude-sdk-python/entrypoint.sh`) are NOT modified — the harness
only exercises them.

### GREEN-1 — MUST-1 volume cut eliminates the wedge (`FIXED=1 ./run.sh`)

The wedge is driven by the flood crossing Railway's drain cap. The two lines
that make the flood are the per-request uvicorn access line and the per-LLM
CVDIAG `outbound-llm` breadcrumb. The fixes remove BOTH from stdout:

- `cvdiag_bootstrap.py` gates the breadcrumb + `emit_cvdiag` `CVDIAG` line
  behind `CVDIAG_LOG_STDOUT` (when `0`/`false`, they stop hitting stdout; the
  PocketBase sink still gets every envelope — no data lost).
- `entrypoint.sh` runs uvicorn with `--no-access-log`.

`FIXED=1 ./run.sh` runs the SAME topology at the post-fix rate: both flood
lines removed, only a residual sub-cap log volume remains (default 1 line per
100 ms tick, ~5× under the 50-lines/sec reader cap). Result: `/health` stays
**200** for the entire window, the flood-tick heartbeat keeps advancing, and
CPU keeps advancing — no wedge. The RED lane (`FIXED=0`, the default) is
retained unchanged for contrast. Transcript saved to
`/tmp/stdout-wedge-green-must1.txt`.

Knobs: `FIXED` (0/1), `FIXED_LINES_PER_TICK` (residual rate, default 1).

### GREEN-2 — MUST-2 public front-door watchdog (`./watchdog.sh`)

`watchdog.sh` exercises the ACTUAL public-`$PORT` guard branch from
`entrypoint.sh` (it first asserts the load-bearing lines are present in the
real file, then runs the guard loop unedited except `sleep 30` → `sleep 1` for
test speed) against a genuinely wedged public-port process, with a local HTTP
server standing in for the Slack webhook. It proves the watchdog (a) detects
the public-port failure at the 3-consecutive-fail threshold, (b) POSTs the LOUD
alert to `$SLACK_WEBHOOK_OSS_ALERTS` BEFORE killing (the captured JSON body is
saved to `/tmp/stdout-wedge-webhook-body.json`), and (c) kills `$NEXTJS_PID` to
trigger the container restart — while the agent-`:8000` guard path stays
unaffected. Transcript saved to `/tmp/stdout-wedge-green-must2.txt`.
