# Personal Finance Copilot — CopilotKit Runtime

A minimal **Next.js (App Router, TypeScript)** service that hosts the CopilotKit
runtime the React Native "Personal Finance Copilot" app points its
`CopilotKitProvider runtimeUrl` at.

It exposes two endpoints:

| Endpoint          | Method                         | Purpose                                                                                  |
| ----------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `/api/copilotkit` | `GET` · `POST` (+ AG-UI verbs) | CopilotKit **v2 / AG-UI** runtime hosting the `default` finance assistant agent.         |
| `/api/receipt`    | `POST`                         | Vision-based receipt parser → `{ merchant, amount, currency, date, suggestedCategory }`. |

## What's inside

- **`app/api/copilotkit/[[...all]]/route.ts`** — wires the **v2** `CopilotRuntime`
  and `createCopilotRuntimeHandler` from
  [`@copilotkit/runtime/v2`](https://www.npmjs.com/package/@copilotkit/runtime),
  registering a single agent under the id **`default`** (the id the RN client
  uses via `useAgent({ agentId: "default" })`). Two things make the AG-UI
  protocol work end-to-end — both were the source of earlier 404/405s:
  - It is mounted at an **optional catch-all** route (`[[...all]]/route.ts`) so
    every AG-UI sub-path (`/info`, `/agent/default/run`,
    `/agent/default/connect`) reaches the handler. A plain `route.ts` 404s the
    sub-paths.
  - It uses the **v2** fetch handler `createCopilotRuntimeHandler`
    (`basePath: "/api/copilotkit"`, `mode: "multi-route"`), which returns a Web
    `(Request) => Response` and strips the base path itself. The v1
    `copilotRuntimeNextJSAppRouterEndpoint` does **not** serve the AG-UI routes
    and returns 405 for `GET /info`.
- **`lib/finance-agent.ts`** — the agent itself: a v2
  [`BuiltInAgent`](https://docs.copilotkit.ai/built-in-agent/quickstart) from
  `@copilotkit/runtime/v2`, configured with a vision-capable model and the
  finance-assistant system prompt. It speaks **AG-UI** natively — the same
  protocol `@copilotkit/react-native` (`@copilotkit/core` + `@ag-ui/client`)
  connects with.
- **`lib/models.ts`** — centralized model selection. The chat agent and the
  receipt parser both default to the vision-capable
  `openai/gpt-5.4-2026-03-05`, each overridable via an env var (`AGENT_MODEL` /
  `RECEIPT_MODEL`).
- **`app/api/receipt/route.ts`** — calls the vision model via the Vercel AI SDK
  (`generateObject` from [`ai`](https://www.npmjs.com/package/ai)) to extract
  structured fields from a receipt image.

### Tools live on the client

The app's tools — `addTransaction`, `createAccount`, `setBudget`, `editBudget`,
the read tools, and `parseReceipt` — are **frontend tools registered by the RN
app**. They are advertised to the agent over AG-UI per request as
_client-provided_ tools, so this runtime does **not** declare them. The agent
proposes actions and the app's human-in-the-loop approval step gates every
write.

## Prerequisites

- Node.js **≥ 22.11** (see `engines` in `package.json`).
- An **OpenAI API key** (the default model `openai/gpt-5.4-2026-03-05` is
  vision-capable and powers both the agent and `/api/receipt`). An Anthropic key
  works too if you switch the model — see below.

## Install & run

```bash
# from this runtime/ directory
npm install

# add your key(s)
cp .env.example .env.local
#   then edit .env.local and set OPENAI_API_KEY=...

npm run dev      # starts Next.js on http://localhost:3000
```

Type-check / build:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # next build (needs a valid API key only at request time)
```

## Environment variables

Copy `.env.example` → `.env.local` and fill in at least one provider key:

| Variable            | Required      | Notes                                                                                |
| ------------------- | ------------- | ------------------------------------------------------------------------------------ |
| `OPENAI_API_KEY`    | yes (default) | Used by the `openai/gpt-5.4-2026-03-05` agent and the receipt parser.                |
| `ANTHROPIC_API_KEY` | optional      | Used if you switch to an `anthropic/claude-*` model.                                 |
| `AGENT_MODEL`       | optional      | Override the chat agent model (e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4.5`). |
| `RECEIPT_MODEL`     | optional      | Override the receipt model. **Must be vision-capable.**                              |

Keys are read from the environment by the underlying AI SDK — they are never
hardcoded.

## Pointing the React Native app at this runtime

Set `RUNTIME_BASE` in the RN app's `App.tsx` to this server's origin. The app
derives both the CopilotKit runtime URL (`${RUNTIME_BASE}/api/copilotkit`,
passed to `CopilotKitProvider runtimeUrl`) and the receipt endpoint
(`${RUNTIME_BASE}/api/receipt`) from that single base:

- **iOS simulator** (shares the host's network) — the committed default works:

  ```ts
  const RUNTIME_BASE = "http://localhost:3000";
  ```

- **Android emulator** — `localhost` is the emulator itself; use the host alias:

  ```ts
  const RUNTIME_BASE = "http://10.0.2.2:3000";
  ```

- **Physical device** (must reach your machine over the LAN — `localhost` on the
  phone is the phone itself):

  ```ts
  // replace with your machine's LAN IP, e.g. 192.168.1.42
  const RUNTIME_BASE = "http://192.168.1.42:3000";
  ```

  Find your LAN IP with `ipconfig getifaddr en0` (macOS Wi-Fi) or
  `ifconfig | grep "inet "`. The phone and computer must be on the same network,
  and `npm run dev` binds all interfaces by default.

> The CopilotKit client appends AG-UI sub-paths to the runtime URL
> (`/info`, `/agent/default/run`, `/agent/default/connect`), so `runtimeUrl`
> points at the **`/api/copilotkit` base** — not at a sub-path.

## `/api/receipt` request shapes

**JSON (base64 or data URL):**

```bash
curl -X POST http://localhost:3000/api/receipt \
  -H "content-type: application/json" \
  -d '{ "image": "data:image/jpeg;base64,/9j/4AAQ..." }'
```

**Multipart upload:**

```bash
curl -X POST http://localhost:3000/api/receipt \
  -F "image=@receipt.jpg"
```

**Response:**

```json
{
  "merchant": "Whole Foods Market",
  "amount": 42.17,
  "currency": "USD",
  "date": "2026-05-30",
  "suggestedCategory": "Groceries"
}
```

Bad input returns `400` with `{ "error": "..." }`; a model/upstream failure
(including a missing API key) returns `502`.

## Changing the model

Either set `AGENT_MODEL` / `RECEIPT_MODEL` in `.env.local`, or edit the defaults
in `lib/models.ts`. Use the provider-prefixed identifiers accepted by CopilotKit
/ the AI SDK, e.g. `openai/gpt-5.4-2026-03-05`, `openai/gpt-4o`,
`anthropic/claude-sonnet-4.5`. Any model used by `/api/receipt` must support
image input.
