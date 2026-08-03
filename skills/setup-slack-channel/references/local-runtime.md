# Local runtime and agent

Two processes for the `examples/OpenTag` starter: a **Python AG-UI agent** and a
**Node runtime** that hosts the Channel. The runtime dials **out** to Intelligence
over a websocket — nothing inbound to your machine, so no tunnel and no public URL
of your own.

Be precise about why: the *runtime↔Intelligence* leg is an outbound websocket, and
the *Slack↔Intelligence* leg is Slack posting HTTPS to Intelligence's own public
Request URL. Neither leg needs a tunnel, and neither leg uses Socket Mode. The
runtime's HTTP port (below) exists for health/serving, not for receiving Slack
events — nothing from Slack ever hits it.

## Prerequisites

| Requirement | Why |
| --- | --- |
| Node.js 22+ | Managed delivery needs the global `WebSocket` |
| pnpm | The starter pins a `packageManager` version — use it, not a system pnpm |
| Python 3.12 + `uv` | Only for a Python agent backend such as OpenTag's |

The packages are **ESM-only**. `"type": "module"` and `import`; `require()` is not
supported.

## Install

```bash
pnpm install --frozen-lockfile
pnpm setup:dev          # OpenTag: uv sync --locked + playwright chromium
```

Check for drift before you debug anything, because reading code that is not the
code being run wastes entire sessions:

```bash
node -e "const p=require('./package.json');console.log(p.dependencies)"
cat node_modules/@copilotkit/channels/package.json 2>/dev/null | grep '"version"'
```

If the installed version differs from `package.json`, say so and **ask** before
reinstalling. A version jump is not a free action mid-session, and it is not
yours to decide unilaterally.

## Configure

```bash
cp .env.example .env
```

The developer fills these in themselves:

| Variable | Required | Notes |
| --- | --- | --- |
| `INTELLIGENCE_API_KEY` | Yes | `cpk-…`, from API Keys in the dashboard. Selects the project. |
| `AGENT_URL` | Yes | The AG-UI endpoint. OpenTag's local agent is `http://localhost:8123/` |
| `OPENAI_API_KEY` | Yes for OpenTag's agent | Model access for the Python agent |
| `INTELLIGENCE_CHANNEL_NAME` | No | Defaults to `open-tag`. Must equal the dashboard Channel's name. |
| `INTELLIGENCE_API_URL` / `INTELLIGENCE_GATEWAY_WS_URL` | No | **Leave unset.** They default to production. |
| `PORT` | No | Runtime HTTP port, default 3000 |

Verify by presence only:

```bash
for v in INTELLIGENCE_API_KEY AGENT_URL OPENAI_API_KEY; do
  grep -q "^\s*\(export \)\?$v=." .env && echo "$v: set" || echo "$v: MISSING"
done
```

On the two endpoint overrides: they are **separate hosts**, so the ws URL cannot
be derived from the API URL. Override both or neither, as bare base URLs with no
`/api` or `/socket` path. Setting one silently leaves the other pointed at the
managed host, and a wrong ws URL does not raise — it hangs in `connecting`.

## Start the agent first

```bash
pnpm agent
curl -s localhost:8123/health
```

A healthy OpenTag agent reports its service name. Start this **before** the
runtime so the first turn does not race a cold backend.

## Start the runtime with logs turned up

```bash
LOG_LEVEL=debug pnpm runtime
```

Use `LOG_LEVEL=debug` every time during setup. The runtime's logger defaults to
`level: process.env.LOG_LEVEL || level || "error"`, and every Channel lifecycle
breadcrumb goes through `logger.warn` — so at the default level the line that
diagnoses your setup is written and thrown away. `channel "<name>" requires setup`
means the Intelligence phase is incomplete.

`pnpm dev` runs both processes with reload. Convenient, but note that any file
save restarts a process — do not edit files in the repo while demonstrating.

## Assert the Channel is actually online

Starting is not connecting. Add this if the app does not already have it —
`examples/OpenTag`'s `server.ts` calls `ready()` and never checks status, so a
Channel with no Slack connection produces a clean, cheerful startup:

```ts
await controls.ready({ timeoutMs: 30_000 });
const status = controls.status();
if (status.overall !== "online") {
  const detail = Object.entries(status.channels)
    .map(([name, state]) => `"${name}": ${state}`)
    .join(", ");
  throw new Error(
    `Channels are not online (overall: ${status.overall}; ${detail}). ` +
      `"setup_required" means the Channel exists in code but has no managed ` +
      `provider attached in Intelligence — confirm the Code matches ` +
      `INTELLIGENCE_CHANNEL_NAME exactly and that its Slack adapter is connected.`,
  );
}
```

Put it **after `ready()` and before `listen()`**, so a dead Channel never gets as
far as printing a listening line. In OpenTag's `server.ts` that is inside the
existing `try`, which means the established cleanup path (`controls.stop()`, close
server, close browser) already handles it. Worth a test with a fake control whose
`status()` returns `setup_required`, asserting startup rejects and never listens —
otherwise the gate itself is untested.

This converts the entire class of "started fine, answers nothing" into a startup
crash that names the state. There is no HTTP endpoint that reports Channel status
— `/api/copilotkit/info` reports license and runtime info — so this in-process
check is the only programmatic source of truth.

## Keep it alive

Managed delivery holds a persistent gateway connection. It needs a long-running
process; a serverless request handler cannot own it. Ctrl-C shuts down cleanly:
the starter stops Channels, the HTTP server, and its renderer once, idempotently,
on SIGINT and SIGTERM.

## Ports

| Port | Process | Override |
| --- | --- | --- |
| 8123 | OpenTag's Python AG-UI agent | `SERVER_PORT` |
| 3000 | Node runtime HTTP | `PORT` |

Before starting, make sure nothing already holds them — a stale process from an
earlier attempt is a common cause of confusing behavior:

```bash
lsof -nP -iTCP:3000 -iTCP:8123 -sTCP:LISTEN
# and, to see which checkout owns a pid:
lsof -a -p <pid> -d cwd -Fn
```

Report what you find. Do not kill a process you did not start without asking,
especially one that may belong to another session.

**A second OpenTag checkout already running is the most likely cause**, and it is
a normal thing for a developer to have. You do not need to stop it — run yours
alongside on different ports instead. Note the agent reads `SERVER_PORT`, not
`PORT`, precisely so it does not consume the Channel runtime's port:

```bash
PORT=3100 SERVER_PORT=8223 AGENT_URL=http://localhost:8223/ LOG_LEVEL=debug pnpm dev
```

Inline vars win over `.env`, because `dotenv` does not overwrite variables already
present in the environment — so this needs no file edit. `AGENT_URL` must be moved
in step with `SERVER_PORT`, or the runtime dials a port with nothing on it.

Two runtimes declaring the **same Code in the same project** race for deliveries
and the loser gets nothing, silently — but two runtimes on *different* Channels
(or different environments) are fine, and only the ports collide.
