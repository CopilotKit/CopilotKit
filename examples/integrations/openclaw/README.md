# CopilotKit × OpenClaw (clawg-ui) demo

A minimal CopilotKit demo that connects a chat UI to **your own OpenClaw
gateway** through the [`clawg-ui`](https://github.com/openclaw/openclaw) channel
plugin's AG-UI operator route. It shows agentic chat plus frontend-tool
generative UI (charts, a human-in-the-loop meeting picker, a theme toggle),
using the [`@ag-ui/openclaw`](https://pkg.pr.new/ag-ui-protocol/ag-ui) client.

Unlike the other integrations, this demo does **not** bundle an agent — it talks
to an OpenClaw gateway you run.

## Prerequisites

- Node.js ≥ 20.9
- A running **OpenClaw gateway** exposing the clawg-ui **operator route**
  (`/v1/clawg-ui/operator`). The clawg-ui plugin ships with OpenClaw, so a
  standard OpenClaw install already exposes it once enabled.
- (Optional) your gateway's **operator token**, if your gateway requires auth.

## Run

```bash
npm install --legacy-peer-deps
cp .env.example .env        # set OPERATOR_URL to your gateway's operator route
npm run dev                 # starts the UI on http://localhost:3000
```

Open http://localhost:3000. You'll be asked (optionally) for your gateway's
operator-route **URL** and its **operator token** — set either/both, or use the
demo default. Both are stored only in this browser. Then chat.

## How the gateway URL & token flow

Both values are stored **only in your browser** (localStorage) and attached to
each request by the `<CopilotKit headers>` function — the token as
`Authorization: Bearer <token>`, the URL as an `x-openclaw-operator-url` header.
The runtime builds the `OpenClawAgent` **per request** (via the `agents`
factory): it reads the URL header to choose which gateway to call and passes the
token as the agent's `gatewayToken`. Send no URL and it falls back to
`OPERATOR_URL`; send no token and no auth header goes out. A wrong or missing
token against a secured gateway surfaces the gateway's auth error.

> **Security note.** The browser-supplied URL becomes a **server-side** request
> from the runtime, so **do not host this demo on a public server as-is** — a
> visitor could point it at internal or cloud-metadata endpoints (an SSRF /
> open-proxy hole). It's meant to be run locally against your own gateway; a
> hosted deployment would need URL allowlisting and internal-IP blocking.

## Configuration

| Env var                    | Default                                      | Purpose                                                                      |
| -------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `OPERATOR_URL`             | `http://localhost:8000/v1/clawg-ui/operator` | **Fallback** gateway operator route, used only when the browser sends no URL |
| `COPILOTKIT_LICENSE_TOKEN` | (unset)                                      | Optional CopilotKit Intelligence (threads/history)                           |

The gateway **URL and token** are normally entered in the browser (stored in
localStorage), not as env vars. `OPERATOR_URL` is just the fallback default.
