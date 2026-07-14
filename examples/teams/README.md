# Teams example: demo bot

A runnable demo of [`@copilotkit/channels`](../../packages/channels): a Microsoft
Teams bot backed by a CopilotKit `BuiltInAgent` that shows
**streamed-by-edit replies**, **agent-rendered Adaptive Cards**, and a
**human-in-the-loop approval gate**, testable locally in the **Microsoft 365
Agents Playground** with **no Microsoft credentials**. It needs an
`OPENAI_API_KEY`. The application depends on the umbrella and imports the Teams
integration from `@copilotkit/channels/teams`.

## Run it

From this directory (after `pnpm install` at the repo root):

```sh
export OPENAI_API_KEY=sk-...   # or add it to .env (see .env.example)
pnpm start                     # starts the bot on http://localhost:3978/api/messages
```

In a second terminal:

```sh
pnpm playground   # opens the M365 Agents Playground at http://localhost:56150
```

Then, in the Playground:

- Ask anything → the agent replies, **streaming in by message edit** (a typing
  indicator first, then text that fills in as it's edited, following Teams'
  baseline post-then-`updateActivity` streaming model).
- Ask for a **summary**, **status**, or any structured data → the agent calls
  the `show_card` tool and posts an **Adaptive Card** (header, facts, table).
- Ask it to **"announce X to the team"** → it drafts the message, posts an
  **Approve/Reject card**, and only sends after you approve (the card updates in
  place to ✅/🚫).

That exercises the CopilotKit bot engine and the Teams adapter end-to-end:
streaming, agent-rendered Adaptive Cards, and human-in-the-loop.

## What's in here

- `app/index.tsx`: the whole bot, covering an in-process `BuiltInAgent` runtime,
  the `createChannel({ adapters: [teams()] })` wiring, an `onMessage` handler that
  runs the agent, and the agent-facing `show_card` tool.
- `app/human-in-the-loop/`: the `confirm_write` approval gate and the Adaptive
  Card it posts. This is user-land code, not SDK code.

## Use a remote agent

By default the example serves an in-process `BuiltInAgent`. To point the bot at
a remote AG-UI endpoint (a deployed CopilotKit runtime, LangGraph, and so on)
instead, swap the `agent` factory to read a URL from the environment:

```ts
agent: (threadId) => {
  const a = new SanitizingHttpAgent({ url: process.env.AGENT_URL! });
  a.threadId = threadId;
  return a;
},
```

## Connect to Microsoft Teams

The Playground needs no credentials; real Teams does. The high-level path:

1. **Register the bot with Microsoft.** Create an [Entra app
   registration](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app)
   and note its Application (client) ID, Directory (tenant) ID, and a client
   secret. Create an [Azure Bot
   resource](https://learn.microsoft.com/azure/bot-service/bot-service-quickstart-registration)
   that uses that app, enable the **Microsoft Teams** channel, and set its
   **messaging endpoint** to `https://<your-host>/api/messages`.
2. **Give the bot the credentials.** Set `clientId` / `clientSecret` /
   `tenantId` (the names the M365 Agents SDK reads) in the bot's environment.
   With them set, the bot acks each turn and runs the agent on a detached
   context, so HITL approvals can resume minutes later.
3. **Build and upload the app package** (below), then in Teams: **Apps → Manage
   your apps → Upload a custom app**.

The full step-by-step walkthrough is in the [Microsoft Teams
guide](../../showcase/shell-docs/src/content/docs/frontends/teams.mdx).

## Build the Teams app package

The app package is the manifest + icons you sideload into Teams. Build it with:

```sh
pnpm package   # -> appPackage/appPackage.zip
```

The script (`appPackage/package.mjs`, dependency-free) reads your bot id from
`MICROSOFT_APP_ID` / `CLIENT_ID` / `clientId` (env or `.env`) and injects it into
the manifest, validates the manifest, and auto-generates placeholder icons if
they're missing, so the committed `manifest.json` stays a placeholder and you
never hardcode your id. See [`appPackage/README.md`](./appPackage/README.md) for
details.

## Files and charts (upload a CSV, get a chart)

The agent can read uploaded files and render charts. Upload a CSV and ask for a
pie/bar chart: the bot parses the data and calls `render_chart`, which posts a
**native Teams chart** (an Adaptive Card chart element, no image generation, no
headless browser). How the file reaches the bot depends on where it's uploaded,
because of a Teams limitation:

- **1:1 (personal) chat** — the file is delivered to the bot inline (requires
  `supportsFiles: true` in the manifest, already set). Works with no extra setup.
- **Channel / group chat** — Teams does **not** send the file to bots here, so
  the bot fetches it through Microsoft Graph. That needs two **application**
  permissions on the bot's Entra app, consented once by a tenant admin:
  - `Files.Read.All` — download the file from SharePoint.
  - `Group.Read.All` (or the manifest's RSC `ChannelMessage.Read.Group`, which a
    team owner can consent without a tenant admin) — read the channel message
    that references the file.

  Without that consent the bot still works — it asks the user to paste the data
  inline (which also renders a chart). To verify the Graph chain in a tenant
  where you control consent before requesting it org-wide, run
  `scripts/verify-graph-channel.ts` (see its header).

Charts render natively in the Teams client, so there's nothing extra to install
(no Chromium, no headless browser). Native charts need a Teams app manifest at
version 1.25+ (already set in `appPackage/manifest.json`).

## Deploy

The bot is a plain HTTP service: it serves `POST /api/messages` (plus a
`/healthz` liveness probe) and binds `PORT`, so it runs anywhere a Node process
does. Teams is an **inbound webhook**, so the service needs a public URL: point
your Azure Bot resource's messaging endpoint at `https://<your-host>/api/messages`.

### Deploy as a workspace member (built from source)

This example consumes `@copilotkit/channels` (and `@copilotkit/runtime`) via the
**`workspace:*`** protocol, so it always builds from the in-repo source —
**not** the npm registry. The Teams integration is imported from the umbrella's
`@copilotkit/channels/teams` subpath. That decouples the deploy from publishing:
a change to `packages/**` redeploys with the new code immediately.

Because it's a workspace member, the deploy must run from the **repo root** so
the workspace and `packages/**` are visible. The bot runs its `BuiltInAgent`
runtime in-process (on `RUNTIME_PORT`, localhost-only), so it's a **single
service** — no separate runtime process. On Railway (or any host), set:

| Setting            | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| **Root Directory** | repo root (`/`)                                                      |
| **Build Command**  | `pnpm install && pnpm --filter teams-example build`                  |
| **Start Command**  | `pnpm --filter teams-example start`                                  |
| **Watch Paths**    | `packages/**`, `examples/teams/**`, `pnpm-lock.yaml`, `package.json` |

`pnpm --filter teams-example build` builds `@copilotkit/channels` and
`@copilotkit/runtime`; Nx brings the Teams adapter in transitively through the
project graph, so `tsx` runs against fresh `dist`. The **Watch Paths** are what
make a `packages/**`-only change trigger a redeploy. On Railway, generate a
public domain on the service (Settings → Networking); it routes to `$PORT`,
which the bot listens on for `/api/messages`.

> **Copying this example out of the monorepo?** Replace the `workspace:*` range
> for `@copilotkit/channels` with its published version (for example,
> `@copilotkit/channels: ^0.1.1`), retain the `@copilotkit/runtime` dependency,
> and import the Teams APIs from `@copilotkit/channels/teams`.

Set the environment for wherever you deploy:

- `OPENAI_API_KEY` _(required)_: the bot runs a `BuiltInAgent` and exits at
  startup without it.
- `OPENAI_MODEL` _(optional)_: defaults to `openai/gpt-5.5`.
- `clientId` / `clientSecret` / `tenantId`: needed to reach real Teams (see
  above). The in-process `BuiltInAgent` runtime stays on `RUNTIME_PORT`
  (localhost-only, default 8200).

Note: the conversation store and pending HITL approvals are **in-memory**, so
they do not survive a restart. Swap in a durable store before relying on
long-lived approvals in production.
