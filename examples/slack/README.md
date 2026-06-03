# slack-example — on-call triage assistant

A runnable demo for [`@copilotkit/slack`](../../packages/slack): a Slack
bot that turns incident chatter into tracked work. It connects to
**Linear** and **Notion** over MCP and can:

- **Query Linear** — _"what's open in CPK this cycle?"_ → renders issues
  as a Block Kit card.
- **File a Linear issue** — _"file this thread as a bug"_ → drafts the
  issue, asks you to **confirm**, then creates it.
- **Find Notion pages** — _"find the runbook for the auth outage"_ →
  renders matching pages with links.
- **Write a postmortem** — _"write this thread up as a Notion doc"_ →
  reads the thread, summarizes, **confirms**, then creates the page.

Every write goes through a human-in-the-loop **`confirm_write`** picker —
and because the picker encodes its resume payload into Slack itself, a
click still works minutes later, even after a deploy restarted the bot.

## How it fits together

```
Slack  ──@mention──▶  bridge (app/)  ──AG-UI──▶  runtime (runtime.ts)
                                                   │  BuiltInAgent (LLM)
                                                   ├── Linear  MCP  (hosted)
                                                   └── Notion  MCP  (sidecar)
```

- **`app/`** — the Slack-side bot: the `read_thread` tool, the
  `issue_list` / `page_list` Block Kit components, the `confirm_write`
  HITL gate, and the bot's context. This is the file you'd copy to start
  your own bot.
- **`runtime.ts`** — the agent backend: a single CopilotKit
  `BuiltInAgent` (LLM + Linear/Notion MCP), served over AG-UI. No Python,
  no LangGraph.
- **`e2e/`** — a live-Slack test harness (sends real messages to a test
  channel) plus a kill-and-restart recovery scenario for the
  `confirm_write` picker.

## Local run

Four pieces: the **Slack app** (created once), the optional **Notion MCP
sidecar**, the **agent** (`runtime.ts`), and the **bridge** (`app/`).

### 1. Slack app

- <https://api.slack.com/apps?new_app=1> → **From a manifest** → paste
  `slack-app-manifest.yaml`.
- _OAuth & Permissions_ → **Install to Workspace** → copy the `xoxb-`
  bot token.
- _Basic Information → App-Level Tokens_ → generate one with
  `connections:write` → copy the `xapp-` app token.

### 2. Credentials

```bash
cp .env.example .env
# Fill in:
#   SLACK_BOT_TOKEN / SLACK_APP_TOKEN
#   OPENAI_API_KEY  (or ANTHROPIC_API_KEY / GOOGLE_API_KEY + AGENT_MODEL)
#   LINEAR_API_KEY          (linear.app → Settings → API → Personal API keys)
#   NOTION_TOKEN            (notion.so → Settings → Connections → integrations)
#   NOTION_MCP_AUTH_TOKEN   (any strong string; shared between the sidecar and the agent)
```

Linear and Notion are independent — set only the ones you want; the agent
wires up whichever credentials are present.

### 3. Notion MCP sidecar (only if using Notion)

The agent talks to Notion through the official MCP server, run locally as
a Streamable-HTTP sidecar:

```bash
pnpm install        # from the repo root
pnpm notion-mcp     # serves http://127.0.0.1:3001/mcp
```

Linear needs no sidecar — its hosted MCP accepts the API key directly.

### 4. Agent

```bash
pnpm runtime        # CopilotKit runtime on :8200, agent "triage"
```

Exposes `http://localhost:8200/api/copilotkit/agent/triage/run` — the
default `AGENT_URL`.

### 5. Bridge

```bash
pnpm dev            # tsx watch app/index.ts
```

### 6. Try it

Invite the bot to a channel and @mention it:

> @CopilotKit Triage what are the open CPK issues this cycle?

> @CopilotKit Triage file this thread as a bug in CPK

> @CopilotKit Triage find the runbook for our last auth outage

> @CopilotKit Triage write this thread up as a Notion postmortem

## Per-user identity

The bridge forwards the **requesting Slack user** (resolved to name + email)
to the agent each turn, so the bot acts on behalf of whoever's asking:
"my issues" is scoped to you, and issues it files are assigned to you. This
needs the `users:read.email` scope (already in the manifest — reinstall the
app once after adding it).

Caveat: a single API key can't forge Linear's `creator`, so created issues
are _authored_ by the bot and _assigned_ to the requester. True per-user
attribution (and reliable Notion personalization) needs per-user OAuth —
see the design notes.

## Live "thinking" indicator

As soon as a run starts, the bot posts a `⏳ thinking…` message with animated
dots so there's no dead air while it reasons or calls Linear/Notion. The
streamed reply reuses that message (dots → answer); if the first output is a
card or a confirm picker, the placeholder is removed. It's part of
`@copilotkit/slack`, on by default.

## Files → charts & diagrams

Upload a file and the bot analyzes it: images and **PDFs** go straight to the
model, and CSV/JSON/text are decoded and handed over as text. The SDK is
transport-only — it downloads the upload and delivers it to the agent as
multimodal content; the **app** decides what to do.

> **PDFs (and images) need a vision/document-capable model.** Claude
> (`anthropic/claude-sonnet-4-6`) and Gemini (`google/gemini-2.5-*`) read PDFs
> natively. OpenAI models do **not** read PDFs through this path — set
> `AGENT_MODEL` to a Claude/Gemini model + its API key to use PDF analysis.

Two app-side tools turn analysis into pictures, rendered **locally** in a
headless browser (reusing the Playwright dep) and posted back inline:

- `render_chart` — the agent emits a Chart.js config; we draw it to a PNG.
- `render_diagram` — the agent emits Mermaid; we render it to a PNG.

Try it: drop a CSV and say _"chart revenue by month"_, or _"diagram this
incident flow"_. Requires a Chromium binary for rendering:

```bash
npx playwright install chromium
```

Notes: image analysis needs a vision-capable `AGENT_MODEL` (e.g.
`openai/gpt-4.1`, `anthropic/claude-sonnet-4.5`). Inbound files are capped
(8 MiB/file, 5 files, 200 KiB of decoded text) — tune via
`createSlackBridge({ files: { … } })`. The chart/diagram libraries load from a
CDN into the local browser (override `CHART_JS_URL` / `MERMAID_URL`); your
data is rendered locally and never sent to a rendering service.

## Deploying

There's nothing local-only here: the bridge and the runtime are plain
Node processes, and every connection is env-driven. Deploy the runtime
and bridge, set the same env vars, and (for Notion) run the
`@notionhq/notion-mcp-server` sidecar alongside the runtime with
`NOTION_MCP_URL` pointed at it.

## Tests

```bash
pnpm test            # unit tests (read_thread, components)
pnpm e2e             # live-Slack case catalog (needs a real workspace + creds)
pnpm e2e:restart     # kill + restart + click recovery for the confirm_write picker
```
