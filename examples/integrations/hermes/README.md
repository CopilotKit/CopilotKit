# CopilotKit <> Hermes Starter

A Next.js + [CopilotKit](https://copilotkit.ai) app that connects to a
[Hermes](https://github.com/NousResearch/Hermes) agent over the
[AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui).

Unlike the other integration examples, **there is no bundled agent here.** You
run your own Hermes AG-UI server (`hermes agui`), then paste its URL — and a
session token, if required — into the app's connect screen. The app talks to
whatever Hermes server you point it at, local or remote.

## Prerequisites

- Node.js 20+
- A running Hermes AG-UI server (see below)
- A package manager: npm, [pnpm](https://pnpm.io/installation),
  [yarn](https://classic.yarnpkg.com/lang/en/docs/install/), or
  [bun](https://bun.sh/)

## 1. Start a Hermes AG-UI server

In your Hermes checkout (with the `[agui]` extra installed):

```bash
hermes agui                 # binds 127.0.0.1:8000 — zero-config, no token
```

A loopback bind needs no token. To expose it on a network interface you **must**
set a session token (an open bind to a terminal-capable agent is remote code
execution):

```bash
export HERMES_AGUI_SESSION_TOKEN="$(openssl rand -hex 24)"
hermes agui --host 0.0.0.0 --port 8000
```

`hermes-agui` and `python -m agui_adapter` are equivalent entry points.

## 2. Run the app

```bash
pnpm install    # or npm install / yarn / bun install
pnpm dev        # or npm run dev / yarn dev / bun run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on a **Connect
to Hermes** screen:

- **Server URL** — defaults to `http://127.0.0.1:8000/`. Point it at your
  server.
- **Session token** — leave blank for a loopback server; paste your
  `HERMES_AGUI_SESSION_TOKEN` when connecting to a networked one.

Click **Connect** and start chatting. Your last connection is remembered; use
the badge in the bottom-left corner to switch servers.

## How it works

- `src/components/hermes-connection.tsx` — the connect screen. It forwards the
  server URL as the `X-Hermes-Url` header and the token as
  `X-Hermes-Session-Token`, via CopilotKit's `headers` prop (auto-forwarded to
  the agent).
- `src/app/api/copilotkit/[[...slug]]/route.ts` — the CopilotKit runtime. Its
  per-request `agents` factory reads `X-Hermes-Url` and builds a
  [`HermesAgent`](https://github.com/ag-ui-protocol/ag-ui/pull/2111) (a thin
  AG-UI `HttpAgent`) pointed at your server. The token rides along on the
  auto-forwarded headers.
- `AGENT_URL` (see `.env.example`) is only the fallback used when no
  `X-Hermes-Url` header is present.

## Security — local / trusted use only

This example is built for **local development**: you run `hermes agui` yourself
and point the app at it. Two consequences to understand before deploying it
anywhere shared or public:

- **The server connects to a client-supplied URL.** The API route builds its
  agent from the `X-Hermes-Url` header the browser sends, with no host
  allowlist, and the CopilotKit runtime forwards `Authorization` + all `x-*`
  headers (including your session token) to that URL. On an untrusted network
  this is an SSRF / open-proxy surface. Before exposing the route publicly, add
  a host + scheme allowlist in `route.ts`, or ignore the client header and pin
  to `AGENT_URL`.
- **The session token is stored in `localStorage`** so the connection is
  remembered across reloads. `localStorage` is readable by any script on the
  origin — acceptable for a local demo, but drop this (or use `sessionStorage`)
  before handling a real credential in a shared environment.

## Available Scripts

- `dev` — start the Next.js dev server (Turbopack)
- `build` — build for production
- `start` — start the production server
- `dev:debug` — `dev` with `LOG_LEVEL=debug`

## Documentation

- [Hermes AG-UI adapter](https://github.com/NousResearch/Hermes) — the server
  this app connects to
- [AG-UI protocol](https://docs.ag-ui.com) — the wire protocol
- [CopilotKit Documentation](https://docs.copilotkit.ai)
- [Next.js Documentation](https://nextjs.org/docs)

## Troubleshooting

**"Failed to connect" / network errors after clicking Connect**

- Confirm the server is running and reachable at the URL you entered
  (`curl <url>` from the same machine the app runs on).
- If the server binds a non-loopback address, it refuses to start without a
  token — and rejects requests that omit or mismatch it. Make sure the token in
  the connect screen matches `HERMES_AGUI_SESSION_TOKEN`.
- The server enforces a `Host` allowlist (DNS-rebind guard) and accepts only
  JSON request bodies; a reverse proxy in front of it must preserve the `Host`
  header and `Content-Type: application/json`.

## License

MIT — see the LICENSE file.
