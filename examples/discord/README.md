# discord-example — on-call triage assistant

A runnable demo for [`@copilotkit/bot-discord`](../../packages/bot-discord): a
Discord bot that turns incident chatter into tracked work. It's built with
[`@copilotkit/bot`](../../packages/bot) (the platform-agnostic bot core),
the Discord adapter, and [`@copilotkit/bot-ui`](../../packages/bot-ui) (a
cross-platform JSX vocabulary for rich messages). It connects to **Linear**
and **Notion** over MCP and can:

- **Query Linear** — _"what's open in CPK this cycle?"_ → renders issues
  as a rich embed card.
- **File a Linear issue** — _"file this thread as a bug"_ → drafts the
  issue, asks you to **confirm**, then creates it.
- **Find Notion pages** — _"find the runbook for the auth outage"_ →
  renders matching pages with links.
- **Write a postmortem** — _"write this thread up as a Notion doc"_ →
  reads the thread, summarizes, **confirms**, then creates the page.

Every write goes through a human-in-the-loop **`confirm_write`** gate: the
agent must call that tool and wait for a Create/Cancel click before it
performs any Linear/Notion write.

> **Unlike the Slack example, there is no app-manifest file.** Discord apps
> are configured entirely through the [Developer Portal](https://discord.com/developers/applications)
> and an invite URL — the steps below walk through it.

## How it fits together

```
Discord  ──@mention──▶  bot (app/)  ──AG-UI──▶  runtime (runtime.ts)
                                                  │  BuiltInAgent (LLM)
                                                  ├── Linear  MCP  (hosted)
                                                  └── Notion  MCP  (sidecar)
```

- **`app/`** — the Discord-side bot: `createBot` + the `discord()` adapter,
  the `read_thread` / `render_chart` / `render_diagram` / `render_table` tools,
  the `issue_card` / `issue_list` / `page_list` render-tools, the
  `confirm_write` HITL gate, and the bot's context. This is the directory
  you'd copy to start your own bot.
- **`runtime.ts`** — the agent backend: a single CopilotKit `BuiltInAgent`
  (LLM + Linear/Notion MCP), served over AG-UI. No Python, no LangGraph.
- **`e2e/`** — a live-Discord test harness (sends real messages to a test
  channel). _Legacy/WIP — see [Tests](#tests)._

## Local run

Four pieces: the **Discord app** (created once), the optional **Notion MCP
sidecar**, the **agent** (`runtime.ts`), and the **bot** (`app/`).

### 1. Discord app setup

1. Go to <https://discord.com/developers/applications> and click
   **New Application**. Give it a name (e.g. "CopilotKit Triage").
2. In the left sidebar open **Bot**.
   - Click **Reset Token** (or copy the existing token) — this is your
     `DISCORD_BOT_TOKEN`.
   - Under **Privileged Gateway Intents**, enable **Message Content Intent**.
     **This is required** — without it the bot receives events but the
     message body is empty, so every mention arrives as an empty string.
3. Back on **General Information**, copy the **Application ID** — this is
   your `DISCORD_APP_ID`.

### 2. Invite the bot to your server

Use the **OAuth2 URL Generator** (sidebar → OAuth2 → URL Generator):

- **Scopes**: `bot` + `applications.commands`
- **Bot permissions**: Send Messages, Read Message History, Use Slash Commands,
  Embed Links

Copy the generated URL and open it in a browser to add the bot to a test
guild. You must be an admin of that guild.

### 3. Slash-command registration tip

By default, Discord global commands can take **up to 1 hour** to propagate.
During development, set `DISCORD_GUILD_ID` to your test guild's ID — commands
registered to a guild appear **instantly**. Remove the env var (or leave it
blank) before deploying to production.

To find your guild ID: right-click the server icon in Discord → _Copy Server
ID_ (Developer Mode must be enabled in User Settings → Advanced).

### 4. Credentials

```bash
cp .env.example .env
# Fill in:
#   DISCORD_BOT_TOKEN / DISCORD_APP_ID
#   DISCORD_GUILD_ID          (optional; guild ID for instant dev slash-commands)
#   OPENAI_API_KEY  (or ANTHROPIC_API_KEY / GOOGLE_API_KEY + AGENT_MODEL)
#   LINEAR_API_KEY            (linear.app → Settings → API → Personal API keys)
#   NOTION_TOKEN              (notion.so → Settings → Connections → integrations)
#   NOTION_MCP_AUTH_TOKEN     (any strong string; shared between the sidecar and the agent)
```

Linear and Notion are independent — set only the ones you want; the agent
wires up whichever credentials are present.

### 5. Notion MCP sidecar (only if using Notion)

The agent talks to Notion through the official MCP server, run locally as
a Streamable-HTTP sidecar:

```bash
pnpm install        # from the repo root
pnpm notion-mcp     # serves http://127.0.0.1:3001/mcp
```

Linear needs no sidecar — its hosted MCP accepts the API key directly.

### 6. Agent

```bash
pnpm runtime        # CopilotKit runtime on :8200, agent "triage"
```

Exposes `http://localhost:8200/api/copilotkit/agent/triage/run` — the
default `AGENT_URL`.

### 7. Bot

```bash
pnpm dev            # tsx watch app/index.ts
```

### 8. Try it

Mention the bot in a channel:

> @CopilotKit Triage what are the open CPK issues this cycle?

> @CopilotKit Triage file this thread as a bug in CPK

> @CopilotKit Triage find the runbook for our last auth outage

> @CopilotKit Triage write this thread up as a Notion postmortem

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from the Developer Portal (Bot page). |
| `DISCORD_APP_ID` | Yes | Application ID from General Information. |
| `DISCORD_GUILD_ID` | No | Guild ID for instant slash-command registration during dev. Omit for global commands. |
| `AGENT_URL` | Yes | AG-UI endpoint served by `runtime.ts`. Default: `http://localhost:8200/api/copilotkit/agent/triage/run`. |
| `OPENAI_API_KEY` | Yes* | Required if using the default `openai/gpt-5.5` model. |
| `ANTHROPIC_API_KEY` | No | Set alongside `AGENT_MODEL=anthropic/claude-sonnet-4-6`. |
| `GOOGLE_API_KEY` | No | Set alongside `AGENT_MODEL=google/gemini-2.5-flash`. |
| `AGENT_MODEL` | No | Override the default model (`openai/gpt-5.5`). |
| `LINEAR_API_KEY` | No | Personal API key from linear.app. Omit to run without Linear. |
| `NOTION_TOKEN` | No | Notion integration secret (`ntn_...`). Omit to run without Notion. |
| `NOTION_MCP_AUTH_TOKEN` | No | Shared bearer secret for the local Notion MCP sidecar. Required if `NOTION_TOKEN` is set. |

## Scripts

| Script | Command | Description |
|---|---|---|
| `runtime` | `pnpm runtime` | Start the CopilotKit agent backend on port 8200. |
| `dev` | `pnpm dev` | Start the bot with hot-reload (`tsx watch`). |
| `start` | `pnpm start` | Start the bot without hot-reload (production). |
| `notion-mcp` | `pnpm notion-mcp` | Run the Notion MCP sidecar on port 3001. |
| `e2e` | `pnpm e2e` | Run the live-Discord e2e harness. |
| `e2e:restart` | `pnpm e2e:restart` | Re-run the e2e recovery path. |

## Deploying

There's nothing local-only here: the bot and the runtime are plain Node
processes, and every connection is env-driven. Deploy the runtime and bot,
set the same env vars, and (for Notion) run the
`@notionhq/notion-mcp-server` sidecar alongside the runtime with
`NOTION_MCP_URL` pointed at it.

## Tests

```bash
pnpm test            # unit tests (read_thread, render tools, components, confirm_write)
```

> **Note:** the live-Discord e2e harness (`pnpm e2e` / `pnpm e2e:restart`) is
> being migrated to the new `createBot` API — it still targets the old bridge
> and the obsolete button-value resume path, so it does not run against this
> example as-is.
