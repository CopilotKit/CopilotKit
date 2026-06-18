# bot-example — on-call triage assistant (Slack &/or Discord)

A runnable demo for [`@copilotkit/bot-slack`](../../packages/bot-slack) **and**
[`@copilotkit/bot-discord`](../../packages/bot-discord): an on-call triage bot
that turns incident chatter into tracked work. It's built with
[`@copilotkit/bot`](../../packages/bot) (the platform-agnostic bot core), one or
both platform adapters, and [`@copilotkit/bot-ui`](../../packages/bot-ui) (a
cross-platform JSX vocabulary for rich messages).

**One app, either platform — or both at once.** `createBot` takes an array of
adapters; `app/index.ts` includes the Slack adapter when `SLACK_*` secrets are
present and the Discord adapter when `DISCORD_*` are present. Everything else in
`app/` (tools, components, the `confirm_write` HITL gate, chart/diagram/table
rendering) is platform-agnostic and shared verbatim — set the secrets for
whichever platform(s) you want and run the same process. It connects to
**Linear** and **Notion** over MCP and can:

- **Query Linear** — _"what's open in CPK this cycle?"_ → renders issues
  as a rich card (Block Kit on Slack, Components V2 on Discord).
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
Slack  ──@mention──▶  bot (app/)  ──AG-UI──▶  runtime (runtime.ts)
                                                │  BuiltInAgent (LLM)
                                                ├── Linear  MCP  (hosted)
                                                └── Notion  MCP  (sidecar)
```

- **`app/`** — the Slack-side bot: `createBot` + the `slack()` adapter, the
  `read_thread` / `render_chart` / `render_diagram` / `render_table` tools,
  the `issue_card` / `issue_list` / `page_list` render-tools, the
  `confirm_write` HITL gate, and the bot's context. This is the directory
  you'd copy to start your own bot.
- **`runtime.ts`** — the agent backend: a single CopilotKit `BuiltInAgent`
  (LLM + Linear/Notion MCP), served over AG-UI. No Python, no LangGraph.
- **`e2e/`** — a live-Slack test harness (sends real messages to a test
  channel). _Legacy/WIP — see [Tests](#tests)._

### The bot (`app/index.ts`)

The whole bot is `createBot` + the Slack adapter, one `onMention` handler,
and `start()`:

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

Pieces: the **chat-platform app(s)** (Slack and/or Discord, created once), the
optional **Notion MCP sidecar**, the **agent** (`runtime.ts`), and the **bot**
(`app/`). Set up whichever platform(s) you want — the bot starts an adapter for
each one whose secrets are present (so you can run Slack-only, Discord-only, or
both from one process).

### 1a. Slack app (set `SLACK_*` to enable Slack)

- <https://api.slack.com/apps?new_app=1> → **From a manifest** → paste
  `slack-app-manifest.yaml`.
- _OAuth & Permissions_ → **Install to Workspace** → copy the `xoxb-`
  bot token (`SLACK_BOT_TOKEN`).
- _Basic Information → App-Level Tokens_ → generate one with
  `connections:write` → copy the `xapp-` app token (`SLACK_APP_TOKEN`).

### 1b. Discord app (set `DISCORD_*` to enable Discord)

- <https://discord.com/developers/applications> → **New Application**.
- **Bot** → copy the token (`DISCORD_BOT_TOKEN`); under **Privileged Gateway
  Intents** enable **both** **Message Content** and **Server Members** — both
  are required or the Gateway login is rejected.
- **General Information** → copy the **Application ID** (`DISCORD_APP_ID`).
- **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`,
  permissions Send Messages / Read Message History / Use Slash Commands /
  Embed Links → open the URL to add it to your server. Optionally set
  `DISCORD_GUILD_ID` (your server id) so slash commands register instantly
  during dev.

### 2. Credentials

```bash
cp .env.example .env
# Fill in (set SLACK_* and/or DISCORD_* — whichever platform(s) you want):
#   SLACK_BOT_TOKEN / SLACK_APP_TOKEN          (to run on Slack)
#   DISCORD_BOT_TOKEN / DISCORD_APP_ID         (to run on Discord; DISCORD_GUILD_ID optional)
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

### Deploy as a workspace member (built from source)

This example consumes the `@copilotkit/*` packages via the **`workspace:*`**
protocol, so it always builds from the in-repo source — **not** the npm
registry. That decouples the deploy from publishing: a change to
`packages/**` redeploys with the new code immediately, and `npm publish` is an
independent, manual step (no "release first, then bump the example" dance).

Because it's a workspace member, the deploy must run from the **repo root** so
the workspace and `packages/**` are visible. On Railway (or any host), set:

| Setting            | Value                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Root Directory** | repo root (`/`)                                                                                                          |
| **Build Command**  | `pnpm install && pnpm --filter slack-example build`                                                                      |
| **Start Command**  | `pnpm --filter slack-example start` (bot) — a second service runs the runtime: `pnpm --filter slack-example run runtime` |
| **Watch Paths**    | `packages/**`, `examples/slack/**`, `pnpm-lock.yaml`, `package.json`                                                     |

`pnpm --filter slack-example build` builds the workspace libs the example
imports (`@copilotkit/bot-slack` / `-discord` / `runtime`) and everything they
depend on, via the Nx project graph — so `tsx` runs against fresh `dist`. The
**Watch Paths** are what makes a `packages/**`-only change trigger a redeploy
(the example's own files no longer need to change to provoke one).

> **Copying this example out of the monorepo?** Replace the `workspace:*`
> ranges in `package.json` with the published versions (e.g.
> `@copilotkit/bot-slack: ^0.0.3`) — `workspace:*` only resolves inside this
> monorepo.

## Tests

```bash
pnpm test            # unit tests (read_thread, render tools, components, confirm_write)
```

> **Note:** the live-Slack e2e harness (`pnpm e2e` / `pnpm e2e:restart`) is
> being migrated to the new `createBot` API — it still targets the old bridge
> and the obsolete button-value resume path, so it does not run against this
> example as-is.
