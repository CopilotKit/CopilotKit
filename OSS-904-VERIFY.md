# OSS-904 — manual browser-verification setup

The runtime connection status is only interesting _mid-session_: the page has to
outlive the runtime. This document sets up an app process and a runtime process
that can be stopped independently, and records the evidence that the separation
actually holds.

## Why the default demo is not enough

`examples/v2/react/demo` mounts the CopilotKit runtime as a Next route handler
(`src/app/api/copilotkit/[[...slug]]/route.ts`). App and runtime are one process,
so stopping "the runtime" stops the app, and restarting it makes the dev server
reload the page. A reload re-runs the startup handshake and paints the status
green on its own — the scenario passes without ever touching the code under test.

The fix here: run the runtime as its own process and point the demo at it.

## The setup

Two processes, two ports:

| process            | port | what it is                                                             |
| ------------------ | ---- | ---------------------------------------------------------------------- |
| standalone runtime | 4002 | `examples/v2/runtime/express` — an existing example, unmodified        |
| demo app           | 3005 | `examples/v2/react/demo` with `NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL` set |

The only repo change is a dev-only escape hatch in the demo:
`examples/v2/react/demo/src/app/runtime-url.ts` exports `DEMO_RUNTIME_URL`, which
is `process.env.NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL || "/api/copilotkit"`. Unset, the
demo behaves exactly as before. Used by `/`, `/sidebar` and `/popup`.

CORS needs no configuration: `createCopilotExpressHandler` defaults to `cors: true`
(`Access-Control-Allow-Origin: *`), so the cross-origin calls from :3005 to :4002
just work.

### Prerequisites

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"   # .nvmrc pins Node 22
cd /Users/dev/Projects/copilotkit/inspector/oss-904-connection-status
pnpm install          # if not already done
pnpm run build        # REQUIRED — the examples import packages/*/dist
```

`pnpm run build` must be re-run after every change to `packages/core` (or any other
workspace package) before the browser sees it. `next dev` does not rebuild them.

`OPENAI_API_KEY` must be in the environment of the **runtime** process (it is
exported from `~/.zshrc`, so a normal terminal has it).

### 1. Start the runtime (terminal A)

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd /Users/dev/Projects/copilotkit/inspector/oss-904-connection-status
PORT=4002 pnpm -C examples/v2/runtime/express exec tsx src/index.ts
```

Use plain `tsx`, **not** `tsx watch` (which is what `pnpm example-dev` runs) — with
`watch` the runtime restarts itself on every file save and you lose control of when
it is up. Expect:

```
Express runtime listening on http://localhost:4002/api/copilotkit
```

### 2. Start the app (terminal B)

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd /Users/dev/Projects/copilotkit/inspector/oss-904-connection-status
NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL=http://localhost:4002/api/copilotkit \
  pnpm -C examples/v2/react/demo dev --port 3005
```

Open <http://localhost:3005>.

`NEXT_PUBLIC_*` is read when the dev server starts, so it has to be set on the
`next dev` command, not exported afterwards.

### Stopping and restarting only the runtime

In terminal A: `Ctrl-C`, then re-run the same command. Or from anywhere:

```bash
kill -9 $(lsof -ti tcp:4002 -sTCP:LISTEN)          # stop
lsof -ti tcp:3005 -sTCP:LISTEN                     # app still listening — page untouched
curl -s -o /dev/null -w '%{http_code}\n' --max-time 3 \
  http://localhost:4002/api/copilotkit/info        # 000 == runtime really gone
```

For scenario 3 (recovery reconciles), edit
`examples/v2/runtime/express/src/index.ts` while the runtime is down — add e.g.
`scratch: new BuiltInAgent({ model: "openai/gpt-5-mini" })` next to `default` —
then restart it. Editing that file does not touch the app; Next does not watch it.

### Convenience wrappers

Both commands are also wrapped as scripts and registered for the browser tooling:

- `/Users/dev/Projects/copilotkit/inspector/start-oss904-runtime.sh` (port 4002)
- `/Users/dev/Projects/copilotkit/inspector/start-oss904-app.sh` (port 3005)
- `/Users/dev/Projects/copilotkit/inspector/.claude/launch.json` — configurations
  `oss904-runtime` and `oss904-app` for `preview_start` / `preview_stop`

These live outside the worktree and are not committed.

## The sessionStorage marker procedure

Even with the separate process, guard every scenario. Paste into the DevTools
console of the app tab **before** stopping the runtime:

```js
sessionStorage.setItem("oss904-marker", String(Date.now()));
performance.timeOrigin; // note this number
```

After the runtime has been stopped (and again after it is restarted), paste:

```js
({
  marker: sessionStorage.getItem("oss904-marker"), // must be the same value
  timeOrigin: performance.timeOrigin, // must be the SAME number
  uptimeMs: Math.round(performance.now()), // must keep increasing
});
```

If `marker` is `null`, or `timeOrigin` changed, or `uptimeMs` went backwards, the page
reloaded and **the result does not count**.

`timeOrigin` is the load-bearing check, not the marker. `sessionStorage` survives a
reload, so the marker on its own only catches a new tab or a lost session — it was
observed intact across a real reload during this setup work.
`performance.getEntriesByType("navigation")[0].type` is _not_ a substitute either: it
describes how the current page instance started, so once a reload has happened it
reads `"reload"` for the rest of that instance's life. Compare `timeOrigin` before
and after.

## Where the runtime status is visible

Open the Inspector with the round CopilotKit launcher in the top-right of the demo
page. It opens on **Home**, and the first card is **System Health**:

- a badge on the card header: **Healthy** (green dot) when connected
- a **Runtime** column: **Available**, with the runtime address underneath —
  `http://localhost:4002/api/copilotkit` in this setup, which is also how you
  confirm at a glance that the app is talking to the standalone process and not to
  its own route
- next to it, **Live updates: Ready** and **Recent activity** (last AG-UI event)

Machine-readable check, from the app tab's console:

```js
document
  .querySelector("cpk-web-inspector")
  .shadowRoot.textContent.replace(/\s+/g, " ")
  .match(/System Health.{0,120}/)[0];
```

The launcher error signal (OSS-903) is the other reader of the same status.

## Evidence

Run 2026-08-24 against `lukas/oss-904-runtime-connection-status`, packages built
from the pre-fix baseline (`packages/core` untouched at the time of the run).

**1 — App loads and reaches the runtime.**
`http://localhost:3005` rendered the demo chat. Network panel showed all CopilotKit
traffic going cross-origin to the standalone process, none to the app's own route:

```
GET  http://localhost:4002/api/copilotkit/info                  -> 200
POST http://localhost:4002/api/copilotkit/agent/default/suggest -> 200
GET  http://localhost:4002/api/copilotkit/threads?agentId=default -> 200
```

Sent "Reply with exactly: PONG-904"; the assistant answered **PONG-904**.

**2 — Killing the runtime leaves the page untouched.**
Marker set to `1787577489519`, `timeOrigin` `1787577420694.3`, `performance.now()`
≈ 68.8 s. Then `kill -9` on PID 71384 (the only listener on :4002).

```
still listening on 4002: ''            <- runtime gone
still listening on 3005: '72581'       <- app alive
runtime /info -> 000                   <- connection refused
app /        -> 200
```

Console immediately after the kill:

```
marker: "1787577489519"          (unchanged)
timeOrigin: 1787577420694.3      (unchanged)
uptimeMs: 88012                  (kept counting from 68826)
pongStillOnScreen: true
inspectorOpen: true              (the open Inspector panel survived too)
```

Sending a message in that state produced a genuinely failed runtime request —
`POST .../agent/default/run [FAILED: net::ERR_CONNECTION_REFUSED]` — with no dev
server reload, which is exactly the condition the fix has to detect.

**3 — Restarting the runtime still does not reload the page.**
Restarted the runtime process. Console:

```
marker: "1787577489519"          (unchanged)
timeOrigin: 1787577420694.3      (unchanged)
uptimeMs: 152299                 (same page instance, ~152 s old)
```

Sent "Reply with exactly: PONG-BACK"; answered **PONG-BACK**. Full transcript still
on screen: `PONG-904` / `Say PONG-DEAD` (unanswered, from the outage) / `PONG-BACK`.

Repeated once more with a runtime **source edit** in between (added a second agent
`scratch`, stopped, restarted): `/info` then reported
`agents: ['default', 'scratch']`, and the page was still at `timeOrigin`
`1787577420694.3` with `uptimeMs: 281039` and the marker intact. So scenario 3 —
add an agent while the runtime is down — is supported without a reload. The edit was
reverted afterwards.

One page instance survived the entire sequence: 0 s → 281 s, no reload, marker never
lost.

A reload _was_ observed later in the session, and it is worth recording because it
is the one thing that still breaks this setup. At 15:22:45 a parallel process
rebuilt `packages/core/dist`; at 15:23:07 the page reloaded (`navType: "reload"`,
new `timeOrigin`, transcript emptied). Turbopack watches the resolved dependency,
so **rebuilding a workspace package reloads the app page** even though the runtime
was never touched. Note also that `sessionStorage` survived that reload intact —
which is exactly why `timeOrigin` and not the marker is the load-bearing check.

A second, independent kill/restart cycle was then run on the new page instance to
confirm the setup itself is unaffected — marker `1787578117980`, `timeOrigin`
`1787577787551.8`, and `performance.now()` 330 s → 343 s (runtime dead) → 362 s
(runtime back), `timeOrigin` never moving.

**4 — Inspector Home shows System Health with the runtime row.**
Launcher opened the panel on Home. Shadow-DOM text:

```
System Health Healthy Runtime Available http://localhost:4002/api/copilotkit
Live updates Ready ... Recent activity RUN_FINISHED
```

The Threads view also renders against this runtime (in-memory store) and issues
`GET /threads` and `GET /threads/<id>/events` to :4002. That traffic exercises
DETECTION through the thread routes — a thread failure while the status is
connected does trigger a check. It does not make scenario 4 runnable: every
binding withholds its thread requests until the status is already connected, so
while the status is red no thread request is issued at all and there is nothing
to recover from. Scenario 4 is NOT DELIVERED; see the not-covered list below.

## Caveats

- **Expected pre-fix failure.** With the runtime killed, System Health still read
  **Healthy / Available**, and the console reported the failure as
  `[CopilotKit] Error (agent_run_failed)` / `agent_run_failed_event` — the
  misclassification OSS-904 is about. That is the bug, not a setup problem. After
  the fix lands, this is what must change.
- **Rebuild after every `packages/*` change — but never mid-scenario.**
  `pnpm run build`, then hard-reload the app tab, _then_ start the scenario.
  `next dev` serves `packages/*/dist`, so an unbuilt fix is invisible and looks like
  the fix not working. And a rebuild while a scenario is in flight rewrites the
  files Turbopack is watching and triggers a full page reload — the same trap the
  separate-process setup exists to remove, arriving from the other direction.
  Observed live: `packages/core/dist` written at 15:22:45, page reloaded at
  15:23:07. If a scenario's `timeOrigin` changed, check whether something rebuilt.
- **The standalone runtime is not feature-identical to the demo route.** The demo's
  own route enables A2UI, Open Generative UI and OpenAI audio transcription, and
  pins `openai/gpt-5.2`; `examples/v2/runtime/express` is a bare `BuiltInAgent` on
  `openai/gpt-5-mini` with none of those (`/info` reports `a2uiEnabled: false`,
  `openGenerativeUIEnabled: false`, `audioFileTranscriptionEnabled: false`).
  Suggestions, threads, frontend tools and chat all work. If a scenario needs A2UI
  or generative UI, copy the runtime config out of
  `examples/v2/react/demo/src/app/api/copilotkit/[[...slug]]/route.ts` into the
  express example first.
- **`OPENAI_API_KEY` has to reach the runtime process, not the app process.** The
  app process needs no key at all in this layout.
- **Enter does not submit** in the demo chat input; click the round send button.
- **`showDevConsole="auto"`** only renders the Inspector on `localhost` /
  `127.0.0.1`, not on a LAN IP.
- **Scenarios still not covered by this setup**: 4 (recovery through other runtime
  traffic — NOT DELIVERED, and not a setup gap: the bindings issue no thread
  requests while the status is red, so the scenario cannot pass as written and
  must not be run), 11 (gateway error — needs a proxy in front of :4002), 12/13
  (Intelligence mode — needs `INTELLIGENCE_API_KEY` and the intelligence-mode
  runtime config), 14 (a customer-owned agent endpoint — needs a third server),
  15 (Vue/Angular demos — they have their own `runtimeUrl` wiring and no
  equivalent env hook yet).
- **Ports 4002 and 3005** were chosen to stay clear of the other Inspector
  worktrees already using 3000–3002 and 5188.
