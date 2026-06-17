# slack-and-telegram-example — on-call triage assistant

A runnable demo for [`@copilotkit/bot-slack`](../../packages/bot-slack) and
[`@copilotkit/bot-telegram`](../../packages/bot-telegram): a bot that turns
incident chatter into tracked work. It's built with
[`@copilotkit/bot`](../../packages/bot) (the platform-agnostic bot core),
the Slack and Telegram adapters, and [`@copilotkit/bot-ui`](../../packages/bot-ui)
(a cross-platform JSX vocabulary for rich messages). It connects to **Linear**
and **Notion** over MCP and can:

- **Query Linear** — _"what's open in CPK this cycle?"_ → renders issues
  as a rich Block Kit card.
- **File a Linear issue** — _"file this thread as a bug"_ → drafts the
  issue, asks you to **confirm**, then creates it.
- **Find Notion pages** — _"find the runbook for the auth outage"_ →
  renders matching pages with links.
- **Write a postmortem** — _"write this thread up as a Notion doc"_ →
  reads the thread, summarizes, **confirms**, then creates the page.

Every write goes through a human-in-the-loop **`confirm_write`** gate: the
agent must call that tool and wait for a Create/Cancel click before it
performs any Linear/Notion write.

## How it fits together

```
Slack / Telegram ──@mention──▶  bot (app/)  ──AG-UI──▶  runtime (runtime.ts)
                                                │  BuiltInAgent (LLM)
                                                ├── Linear  MCP  (hosted)
                                                └── Notion  MCP  (sidecar)
```

- **`app/`** — the bot application, platform-neutral: `createBot` started for
  the `slack()` and/or `telegram()` adapter (whichever credentials are set),
  the `read_thread` / `render_chart` / `render_diagram` / `render_table` tools,
  the `issue_card` / `issue_list` / `page_list` render-tools, the showcase
  tools, the `confirm_write` HITL gate, and the bot's context. The components
  emit a cross-platform JSX IR that each adapter renders natively. This is the
  directory you'd copy to start your own bot.
- **`runtime.ts`** — the agent backend: a single CopilotKit `BuiltInAgent`
  (LLM + Linear/Notion MCP), served over AG-UI. No Python, no LangGraph.
- **`e2e/`** — live test harnesses. The Slack harness (`run.ts` /
  `restart-recovery.ts`, `pnpm e2e`) is _legacy/WIP — see [Tests](#tests)_; the
  Telegram harness (`telegram-run.ts`, `pnpm e2e:telegram`) is a manual-trigger
  smoke test — see [`e2e/TELEGRAM-README.md`](e2e/TELEGRAM-README.md).

### The bot (`app/index.ts`)

The core shape is `createBot` + an adapter, one `onMention` handler, and
`start()`. The snippet below is an **abridged, single-platform sketch** — the
real `app/index.ts` starts a Slack and/or Telegram bot depending on which
credentials are set, threads `agentHeaders`, and adds graceful shutdown; read
the file for the full dual-platform wiring:

```ts
import { createBot } from "@copilotkit/bot";
import {
  slack,
  defaultSlackTools,
  defaultSlackContext,
  SanitizingHttpAgent,
} from "@copilotkit/bot-slack";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";

const bot = createBot({
  adapters: [
    slack({
      botToken: process.env.SLACK_BOT_TOKEN!,
      appToken: process.env.SLACK_APP_TOKEN!,
    }),
  ],
  // One AG-UI agent per Slack conversation, pointed at the runtime.
  agent: (threadId) => {
    const a = new SanitizingHttpAgent({ url: process.env.AGENT_URL! });
    a.threadId = threadId;
    return a;
  },
  // defaultSlackTools ships universal-Slack tools (e.g. lookup_slack_user
  // for @-mentions); appTools adds this bot's tools. defaultSlackContext
  // ships tagging/mrkdwn/thread-model guidance; appContext adds identity +
  // triage policy.
  tools: [...defaultSlackTools, ...appTools],
  context: [...defaultSlackContext, ...appContext],
});

// One handler covers @-mentions, replies in threads the bot owns, and DMs.
// senderContext names the requesting Slack user so the agent acts "as" them.
bot.onMention(async ({ thread, message }) => {
  await thread.runAgent({ context: senderContext(message.user) });
});

await bot.start();
```

### Tools (`app/tools/index.ts`)

The bot's tools are plain `BotTool`s, collected into `appTools` and spread
into `createBot({ tools })`. Each handler receives the generic
`BotToolContext` (`{ thread, message?, user?, signal?, platform }`) the
adapter supplies at call time; tools reach platform power (post, postFile,
`thread.getMessages()`, …) via the `thread` methods:

- **`read_thread`** — fetches the messages in the current Slack thread so
  the agent can summarize/act on a real conversation (e.g. "write this
  thread up as a postmortem") instead of inventing content.
- **`render_chart`** — the agent emits a Chart.js config; rendered to a PNG
  **locally** in a headless browser (reusing the Playwright dep) and posted
  inline.
- **`render_diagram`** — the agent emits Mermaid; rendered to a PNG the same
  way.
- **`render_table`** — the agent emits columns + rows; posted as a native
  Slack **Table block** (no browser needed), with a monospace fallback.

### UI as JSX components

Rich messages are authored as JSX components over the `@copilotkit/bot-ui`
vocabulary (`<Message>`, `<Header>`, `<Section>`, `<Context>`, `<Actions>`,
`<Button>`, …). Each component (`IssueCard`, `IssueList`, `PageList`,
`ConfirmWrite`) is a plain function whose zod prop schema doubles as a tool
input schema.

The agent renders them through **render-tools** — `BotTool`s that wrap a
component and post it. The agent calls the tool; the handler renders the
component and posts it to the thread:

```tsx
export const issueCardTool: BotTool<typeof issueCardSchema> = {
  name: "issue_card",
  description: "Render ONE Linear issue as a rich Block Kit card …",
  parameters: issueCardSchema,
  async handler(props, { thread }) {
    await thread.post(<IssueCard {...props} />);
    return JSON.stringify({ ok: true, rendered: "issue_card" });
  },
};
```

The three render-tools are **`issue_card`** (a single Linear issue, or one
you just created with `justCreated: true`), **`issue_list`** (several Linear
issues), and **`page_list`** (Notion pages). The system prompt steers the
agent to present results with these instead of prose.

### Human-in-the-loop: `confirm_write`

HITL is a **blocking frontend tool**. Before any Linear/Notion write the
agent must call `confirm_write`, whose handler posts a Create/Cancel card
and blocks until the user clicks — then resolves to the clicked button's
`value`, `{ confirmed: boolean }`. The agent only performs the write when it
gets back `{ confirmed: true }`.

```tsx
export const confirmWriteTool: BotTool<typeof confirmWriteSchema> = {
  name: "confirm_write",
  description:
    "Ask the user to approve a write before you perform it … returns {confirmed}.",
  parameters: confirmWriteSchema,
  async handler({ action, detail }, { thread }) {
    const choice = await thread.awaitChoice(
      <ConfirmWrite action={action} detail={detail} />,
    );
    return JSON.stringify(choice ?? { confirmed: false });
  },
};
```

`<ConfirmWrite>` is a JSX card whose Create/Cancel `<Button>`s each carry a
`value` (`{ confirmed: true|false }`) and an inline `onClick` that updates
the card in place to an approved/declined state — so the picker reflects the
decision the moment it's clicked.

### Slash commands (`app/commands/`)

Two app-owned slash commands, registered via `createBot({ commands })`:

- **`/agent <text>`** — a mention-free entry point; runs the agent with the
  command text as the prompt.
- **`/triage [note]`** — summarizes the conversation and proposes Linear
  issues to file.

```ts
defineBotCommand({
  name: "agent",
  description: "Ask the triage agent anything (no @mention needed).",
  async handler({ thread, text, user }) {
    if (!text) return void thread.post("Usage: `/agent <your question>`");
    await thread.runAgent({ prompt: text, context: senderContext(user) });
  },
});
```

The args arrive as `ctx.text`; `runAgent({ prompt })` injects them as the
user message (a slash command's text is never posted to the channel, so it
isn't in the history the agent reconstructs).

> **Slack setup:** each command must also be declared in your Slack app under
> **Slash Commands** (add `/agent` and `/triage`) — Slack won't deliver an
> unregistered command, even over Socket Mode. The command name there must
> match the registered `name`.

### The agent (`runtime.ts`)

A single CopilotKit `BuiltInAgent` (LLM + MCP) served over AG-UI by a
`CopilotSseRuntime`. It connects to Linear (hosted MCP, raw API key as
bearer token) and Notion (the official MCP server run as a local
Streamable-HTTP sidecar), discovering the available list/search/create tools
from each server at runtime. A server is only wired up when its credentials
are present, so the bot runs Linear-only, Notion-only, or both. The default
model is `openai/gpt-5.5` (override with `AGENT_MODEL`).

## Local run

Four pieces: the **Slack app** (created once), the optional **Notion MCP
sidecar**, the **agent** (`runtime.ts`), and the **bot** (`app/`).

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

### 5. Bot

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

The `onMention` handler forwards the **requesting Slack user** (resolved to
name + email) to the agent each turn via `senderContext(message.user)`, so
the bot acts on behalf of whoever's asking: "my issues" is scoped to you,
and issues it files are assigned to you. This needs the `users:read.email`
scope (already in the manifest — reinstall the app once after adding it).

Caveat: a single API key can't forge Linear's `creator`, so created issues
are _authored_ by the bot and _assigned_ to the requester. True per-user
attribution (and reliable Notion personalization) needs per-user OAuth.

## Files → charts, diagrams & tables

Upload a file and the bot analyzes it: images and **PDFs** go straight to the
model, and CSV/JSON/text are decoded and handed over as text. The adapter is
transport-only — it downloads the upload and delivers it to the agent as
multimodal content; the **app** (the `render_*` tools above) decides what to
do.

> **PDFs and images need a vision/document-capable model.** The default
> `openai/gpt-5.5` reads both natively through this path, as do recent Claude
> (`anthropic/claude-sonnet-4-6`) and Gemini (`google/gemini-2.5-*`) models.
> An older text-only model will ignore the attached document.

Try it: drop a CSV and say _"chart revenue by month"_, _"diagram this incident
flow"_, or _"show the incidents as a table"_. The chart/diagram renderers need
a Chromium binary:

```bash
npx playwright install chromium
```

Notes: the chart/diagram libraries load from a CDN into the local browser
(override `CHART_JS_URL` / `MERMAID_URL`); your data is rendered locally and
never sent to a rendering service.

## Deploying

There's nothing local-only here: the bot and the runtime are plain Node
processes, and every connection is env-driven. Deploy the runtime and bot,
set the same env vars, and (for Notion) run the
`@notionhq/notion-mcp-server` sidecar alongside the runtime with
`NOTION_MCP_URL` pointed at it.

> **Deploying from this monorepo (e.g. Railway):** the Slack-side packages
> (`@copilotkit/bot`, `@copilotkit/bot-slack`, `@copilotkit/bot-ui`) are
> published, so a build installs them from npm. The pnpm lockfile lives at the
> **repo root**, so make sure each service's **watch paths** include
> `pnpm-lock.yaml` and `package.json` (not just `examples/slack/**`) — otherwise
> a dependency bump won't trigger a redeploy and a frozen install can fail with
> an out-of-date lockfile.
>
> **Telegram support is new:** `@copilotkit/bot-telegram` is not published yet,
> so it is referenced as `workspace:*` and the example currently runs **from the
> monorepo** (`pnpm --filter slack-example start`). Standalone deploys (the
> example's own `pnpm-lock.yaml`) work for Slack today; once `bot-telegram`
> publishes alongside its siblings, switch the dep to `~0.0.2` and regenerate the
> standalone lockfile to enable standalone Telegram deploys.

## Tests

```bash
pnpm test            # unit tests (read_thread, render tools, components, confirm_write)
```

> **Note:** the live-Slack e2e harness (`pnpm e2e` / `pnpm e2e:restart`) is
> being migrated to the new `createBot` API — it still targets the old bridge
> and the obsolete button-value resume path, so it does not run against this
> example as-is.

---

## Running on Telegram

This same app also runs a Telegram bot using the
[`@copilotkit/bot-telegram`](../../packages/bot-telegram) adapter. The app
starts whichever platform's credentials are present — Slack-only, Telegram-only,
or both simultaneously.

### 1. BotFather setup

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts — choose a display name and a
   username (must end in `bot`). BotFather replies with your **bot token**
   (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`).
3. **Enable group message access:** send `/setprivacy` to BotFather, select
   your bot, then choose **Disable**. This lets the bot see messages it's
   @mentioned in or replied to inside group chats. (Privacy mode is on by
   default — without this step the bot only sees commands and DMs.)
4. **Slash commands are auto-published on startup** — the adapter calls
   `setMyCommands` via `registerCommands` when `bot.start()` runs, so
   `/agent` and `/triage` appear in Telegram's command menu automatically.
   No manual `/setcommands` step in BotFather is needed.

### 2. Credentials

Add the following to your `.env`:

```bash
TELEGRAM_BOT_TOKEN=<token from BotFather>
```

You do **not** need to change `OPENAI_API_KEY`, `LINEAR_API_KEY`, or
`NOTION_TOKEN` — they are shared with the Slack adapter.

### 3. Start the bot

```bash
pnpm start          # tsx app/index.ts — starts whichever adapters are configured
```

Long-polling is the default ingress (no public URL or webhook setup required).
To switch to webhook mode see the `telegram()` adapter options; the default
`mode: "polling"` works for development and most production deployments.

### 4. Try it

Start a DM with your bot or add it to a group and @mention it:

> @YourBotUsername what are the open CPK issues this cycle?

> @YourBotUsername file this thread as a bug in CPK

Or use the slash commands (appear automatically in the Telegram command menu):

> /agent what's open in CPK this sprint?

> /triage

### 5. Ingress modes

| Mode      | How it works                                                                     |
| --------- | -------------------------------------------------------------------------------- |
| `polling` | **Default.** grammY long-polling. No public URL needed.                          |
| `webhook` | grammY webhook + minimal Node HTTP server. Requires `webhook.domain`.            |
| `auto`    | Webhook when `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME`/`NETLIFY` is set, else polling. |

### 6. Telegram e2e

A live end-to-end harness for the Telegram bot lives alongside the Slack one:

```bash
# Requires TELEGRAM_BOT_TOKEN + TELEGRAM_TEST_CHAT_ID in .env
pnpm e2e:telegram

# Run a single case by name filter:
CASE_FILTER='C1' pnpm e2e:telegram
```

By default the harness runs in **manual-trigger** mode: it prints each test
prompt and waits for you to send it in the Telegram chat, then polls the bot's
reply and validates it. Set `TELEGRAM_SENDER_BOT_TOKEN` in `.env` (a second
"sender" bot added to a shared group) for fully automated sending. See
[`e2e/TELEGRAM-README.md`](./e2e/TELEGRAM-README.md) for full details.
