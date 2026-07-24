# bot-example — on-call triage assistant (Slack, Discord, Telegram &/or WhatsApp)

A runnable demo for [`@copilotkit/channels`](../../packages/channels): an on-call triage
bot that turns incident chatter into tracked work. The umbrella supplies the
platform-agnostic bot core and cross-platform JSX vocabulary; use its
`@copilotkit/channels/slack`, `@copilotkit/channels/discord`,
`@copilotkit/channels/telegram`, and `@copilotkit/channels/whatsapp` subpaths for
the platform adapters.

**One app, any platform — or all at once.** `createChannel` takes an array of
adapters; `app/index.ts` includes the Slack adapter when `SLACK_*` secrets are
present, the Discord adapter when `DISCORD_*` are present, the Telegram adapter
when `TELEGRAM_BOT_TOKEN` is present, and the WhatsApp adapter when `WHATSAPP_*`
are present. Everything else in `app/` (tools,
components, the `confirm_write` HITL gate, table rendering) is
platform-agnostic and shared verbatim — set the secrets for whichever
platform(s) you want and run the same process. It connects to **Linear** and
**Notion** over MCP and can:

- **Query Linear** — _"what's open in CPK this cycle?"_ → renders issues
  as a rich card (Block Kit on Slack, Components V2 on Discord, HTML on
  Telegram).
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
Slack / Discord / Telegram ──@mention──▶  bot (app/)  ──AG-UI──▶  runtime (runtime.ts)
                                                          │  BuiltInAgent (LLM)
                                                          ├── Linear  MCP  (hosted)
                                                          └── Notion  MCP  (sidecar)
```

- **`app/`** — the platform-agnostic bot: `createChannel` + whichever of the
  `slack()` / `discord()` / `telegram()` adapters have secrets, the
  `read_thread` / `render_table` tools,
  the `issue_card` / `issue_list` / `page_list` render-tools, the
  `confirm_write` HITL gate, and the bot's context. The components emit a
  cross-platform JSX IR that each adapter renders natively. This is the
  directory you'd copy to start your own bot.
- **`runtime.ts`** — the agent backend: a single CopilotKit `BuiltInAgent`
  (LLM + Linear/Notion MCP), served over AG-UI. No Python, no LangGraph.
- **`e2e/`** — live test harnesses. The Slack harness (`run.ts` /
  `restart-recovery.ts`, `pnpm e2e`) is _legacy/WIP — see [Tests](#tests)_;
  the Telegram harness (`telegram-run.ts`, `pnpm e2e:telegram`) is a
  manual-trigger smoke test — see [`e2e/TELEGRAM-README.md`](e2e/TELEGRAM-README.md).

### The bot (`app/index.ts`)

The core shape is `createChannel` + one or more adapters, an `onMention` handler,
and `start()`. The snippet below is an **abridged, single-platform sketch** —
the real `app/index.ts` builds the adapter list from whichever secrets are
present (Slack, Discord, and/or Telegram) and adds graceful shutdown; read the
file for the full multi-platform wiring:

```ts
import { createChannel } from "@copilotkit/channels";
import {
  slack,
  defaultSlackTools,
  defaultSlackContext,
  SanitizingHttpAgent,
} from "@copilotkit/channels/slack";
import { appTools } from "./tools/index.js";
import { appContext } from "./context/app-context.js";

const bot = createChannel({
  adapters: [
    slack({
      botToken: process.env.SLACK_BOT_TOKEN!,
      appToken: process.env.SLACK_APP_TOKEN!,
      respondTo: {
        directMessages: true,
        appMentions: { reply: "thread" },
        threadReplies: "mentionsOnly",
      },
    }),
  ],
  // One AG-UI agent per conversation, pointed at the runtime.
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

// One handler covers explicit @-mentions and normal DMs.
// senderContext names the requesting user so the agent acts "as" them.
bot.onMention(async ({ thread, message }) => {
  await thread.runAgent({ context: senderContext(message.user) });
});

await bot.start();
```

The runnable Slack example keeps DMs and the assistant pane conversational, but
channel/private-channel threads require `@Kite` on each follow-up by default.
Set `respondTo.threadReplies: "afterBotReply"` to restore legacy behavior where
plain replies in a thread can continue after the bot has posted there.

### Tools (`app/tools/index.ts`)

The bot's tools are plain `ChannelTool`s, collected into `appTools` and spread
into `createChannel({ tools })`. Each handler receives the generic
`ChannelToolContext` (`{ thread, message?, user?, signal?, platform }`) the
adapter supplies at call time; tools reach platform power (post, postFile,
`thread.getMessages()`, …) via the `thread` methods:

- **`read_thread`** — fetches the messages in the current conversation thread
  so the agent can summarize/act on a real conversation (e.g. "write this
  thread up as a postmortem") instead of inventing content.
- **`render_table`** — the agent emits columns + rows; rendered natively per
  platform (a Slack Table block, otherwise a monospace fallback).

### UI as JSX components

Rich messages are authored as JSX components over the `@copilotkit/channels`
vocabulary (`<Message>`, `<Header>`, `<Section>`, `<Context>`, `<Actions>`,
`<Button>`, …). Each component (`IssueCard`, `IssueList`, `PageList`,
`ConfirmWrite`) is a plain function whose zod prop schema doubles as a tool
input schema. Each adapter renders the same IR natively (Block Kit on Slack,
Components V2 on Discord, HTML on Telegram).

The agent renders them through **render-tools** — `ChannelTool`s that wrap a
component and post it. The agent calls the tool; the handler renders the
component and posts it to the thread:

```tsx
export const issueCardTool: ChannelTool<typeof issueCardSchema> = {
  name: "issue_card",
  description: "Render ONE Linear issue as a rich card …",
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

### Images from JSX — `render_mrr`

Not every visualization fits the channel-UI vocabulary. **`render_mrr`**
demonstrates posting **arbitrary app JSX as an image**: `<MrrCard/>` (a plain
`react` component, not a `@copilotkit/channels` component) and an optional
signups `<BarChart>` from `@copilotkit/channels/charts` are posted straight
to `thread.post` — no wrapper, no explicit "render to image" call.

```tsx
export const renderMrrTool: ChannelTool<typeof schema> = {
  name: "render_mrr",
  description:
    "Render an MRR summary card (and optional signups bar chart) as images and post them to the thread.",
  parameters: schema,
  async handler({ value, delta, series }, { thread }) {
    await thread.post(<MrrCard value={value} delta={delta} />, {
      filename: "mrr.png",
      title: "MRR",
    });
    if (series?.length) {
      await thread.post(<BarChart title="Signups / day" data={series} />, {
        filename: "signups.png",
      });
    }
    return (
      "Posted the MRR card" + (series?.length ? " and signups chart." : ".")
    );
  },
};
```

`thread.post` detects that `<MrrCard/>` and `<BarChart/>` return plain React
elements (not the channels-ui vocabulary) and routes them through
[Takumi](https://github.com/takumi-rs/takumi) — a static, in-process
rasterizer — to a PNG, then uploads it through the same `postFile` path used
everywhere else in this bot.

**Source:** `app/tools/render-mrr.tsx`, `app/components/mrr-card.ts`.

> `react` and `takumi-js` are dependencies of this example for that reason —
> there is no headless browser (the old Playwright-based `render_chart` /
> `render_diagram` tools are gone) at runtime; rendering happens in-process.

### Showcase features: shadcn cards + charts as images

Three realistic "we run this in our own Slack" features (`app/showcase/`), each
rendering a **shadcn-styled card** plus **charts** as images, and each
triggerable **two ways** — a slash command _and_ a prompt (the agent calls the
matching `render_*` tool). Both paths share one `render*` fn.

| Feature              | Slash / prompt               | Data                          | Renders                                                                         |
| -------------------- | ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| **PR review radar**  | `/prs` · "show the PR radar" | GitHub PRs (public, no token) | card of oldest open PRs (age-coloured badges) + PRs-by-age bar chart            |
| **Weekly OSS pulse** | `/pulse` · "weekly pulse"    | GitHub + npm (public)         | KPI card (stars · downloads · issues) + downloads line chart + issues bar chart |
| **Linear standup**   | `/standup` · "cycle standup" | Linear (`LINEAR_API_KEY`)     | per-team progress card (a meter per team) + done-vs-remaining stacked bar       |

The shadcn look comes from a single token stylesheet fed once to
`createChannel({ render: { stylesheets: [shadcnCss] } })` (`app/showcase/theme.ts`);
cards set layout inline and pull colour/type from classes. Text is Geist
(Takumi's built-in font). Every feature reads **live** data and **falls back to
sample data** (never throws) when the API is unreachable, labelling the card
`sample data` so the degradation is visible.

```ts
// One render fn, two triggers — app/showcase/pr-radar.tsx
export async function renderPrRadar(thread) {
  const { prs, live } = await fetchPrRadar();           // live GitHub or sample
  await thread.post(<PrRadarCard prs={prs} live={live} />, { filename: "pr-radar.png", width: 760, height: 150 + prs.length * 40 });
  if (prs.length) await thread.post(<BarChart title="Open PRs by age" data={byAgeBucket(prs)} />, { filename: "pr-age.png" });
}
export const prRadarTool = defineChannelTool({ name: "render_pr_radar", /* … */ async handler(_, { thread }) { return renderPrRadar(thread); } });
export const prsCommand   = defineChannelCommand({ name: "prs", /* … */ async handler({ thread }) { await renderPrRadar(thread); } });
```

**Source:** `app/showcase/` — `pr-radar.tsx`, `weekly-pulse.tsx`,
`cycle-standup.tsx`, `theme.ts`, `lib.ts`.

### Human-in-the-loop: `confirm_write`

HITL is a **blocking frontend tool**. Before any Linear/Notion write the
agent must call `confirm_write`, whose handler posts a Create/Cancel card
and blocks until the user clicks — then resolves to the clicked button's
`value`, `{ confirmed: boolean }`. The agent only performs the write when it
gets back `{ confirmed: true }`.

```tsx
export const confirmWriteTool: ChannelTool<typeof confirmWriteSchema> = {
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
decision the moment it's clicked. (On Telegram the value can't ride in the
64-byte `callback_data`, so the core recovers it from the rendered button.)

### Slash commands (`app/commands/`)

App-owned slash commands, registered via `createChannel({ commands })`:

- **`/agent <text>`** — a mention-free entry point; runs the agent with the
  command text as the prompt.
- **`/triage [note]`** — summarizes the conversation and proposes Linear
  issues to file.
- **`/preview <title>`** — privately previews the issue the bot would file
  (only you see it); degrades to a DM on platforms without ephemeral messages.
- **`/file-issue`** — opens a structured Linear issue form; degrades to a
  conversational flow on platforms without modal support (e.g. Telegram).
- **`/prs`**, **`/pulse`**, **`/standup`** — the showcase features (see
  [Showcase features](#showcase-features-shadcn-cards--charts-as-images)
  below). Each renders a shadcn-style card + charts as images and is **also**
  triggerable by prompt (the matching `render_*` tool), so the same feature
  works whether you type the slash command or just ask the agent for it.

```ts
defineChannelCommand({
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

> **Slack setup:** every command (`/agent`, `/triage`, `/preview`,
> `/file-issue`, `/prs`, `/pulse`, `/standup`) must be declared in your Slack
> app under **Slash Commands** — Slack won't deliver an unregistered command,
> even over Socket Mode. The easiest path is to paste the full
> `slack-app-manifest.yaml` when creating (or updating) your app, which already
> declares all of them. Discord and Telegram register their commands up front
> via the adapter.

### The agent (`runtime.ts`)

A single CopilotKit `BuiltInAgent` (LLM + MCP) served over AG-UI by a
`CopilotSseRuntime`. It connects to Linear (hosted MCP, raw API key as
bearer token) and Notion (the official MCP server run as a local
Streamable-HTTP sidecar), discovering the available list/search/create tools
from each server at runtime. A server is only wired up when its credentials
are present, so the bot runs Linear-only, Notion-only, or both. The default
model is `openai/gpt-5.5` (override with `AGENT_MODEL`).

## Local run

Pieces: the **chat-platform app(s)** (Slack, Discord, and/or Telegram, created
once), the optional **Notion MCP sidecar**, the **agent** (`runtime.ts`), and
the **bot** (`app/`). Set up whichever platform(s) you want — the bot starts an
adapter for each one whose secrets are present (so you can run any one, or
several from one process).

> **This example runs from the monorepo.** Its application-level Channels
> dependency is `@copilotkit/channels`; the root export and platform subpaths all
> resolve from that umbrella. The Telegram adapter implementation is not published
> separately yet, so all `@copilotkit/*` deps are `workspace:*` and the example runs
> against local source: `pnpm --filter slack-example <script>`. Once the umbrella
> version publishes, use its published range for a standalone build and keep the
> platform imports on `@copilotkit/channels/<platform>`.

### 1a. Slack app (set `SLACK_*` to enable Slack)

- <https://api.slack.com/apps?new_app=1> → **From a manifest** → paste
  `slack-app-manifest.yaml`.
- _OAuth & Permissions_ → **Install to Workspace** → copy the `xoxb-`
  bot token (`SLACK_BOT_TOKEN`).
- _Basic Information → App-Level Tokens_ → generate one with
  `connections:write` → copy the `xapp-` app token (`SLACK_APP_TOKEN`).
- The manifest is tuned for mention-only channel threads. If you enable
  `respondTo.threadReplies: "afterBotReply"`, also subscribe to
  `message.channels` and `message.groups` so Slack delivers plain thread
  replies.

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

### 1c. Telegram bot (set `TELEGRAM_BOT_TOKEN` to enable Telegram)

- In Telegram, message **@BotFather** → `/newbot` → follow the prompts (name +
  a username ending in `bot`) → copy the HTTP API token (`TELEGRAM_BOT_TOKEN`).
- Long-polling is the default ingress — no public URL or webhook needed.
- The bot auto-registers its slash commands (`/agent`, `/triage`, `/preview`,
  `/file-issue`, `/prs`, `/pulse`, `/standup` — all passed to `createChannel`) via `setMyCommands` on start
  (no manual BotFather `/setcommands` step). For group use, `/setprivacy` →
  **Disable** if you want it to see non-mention messages.

### 2. Credentials

```bash
cp .env.example .env
# Fill in (set SLACK_*, DISCORD_*, and/or TELEGRAM_BOT_TOKEN — whichever you want):
#   SLACK_BOT_TOKEN / SLACK_APP_TOKEN          (to run on Slack)
#   DISCORD_BOT_TOKEN / DISCORD_APP_ID         (to run on Discord; DISCORD_GUILD_ID optional)
#   TELEGRAM_BOT_TOKEN                         (to run on Telegram)
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
pnpm install                          # from the repo root
pnpm --filter slack-example notion-mcp   # serves http://127.0.0.1:3001/mcp
```

Linear needs no sidecar — its hosted MCP accepts the API key directly.

### 4. Agent

```bash
pnpm --filter slack-example runtime   # CopilotKit runtime on :8200, agent "triage"
```

Exposes `http://localhost:8200/api/copilotkit/agent/triage/run` — the
default `AGENT_URL`.

### 5. Bot

```bash
pnpm --filter slack-example dev       # tsx watch app/index.ts
```

### 6. Try it

@mention the bot in a channel (Slack/Discord) or DM it / @mention it in a
group (Telegram). In Slack channel threads, mention Kite again for each
follow-up unless you enabled legacy thread continuation:

> @CopilotKit Triage what are the open CPK issues this cycle?

> @CopilotKit Triage file this thread as a bug in CPK

> @CopilotKit Triage find the runbook for our last auth outage

> @CopilotKit Triage write this thread up as a Notion postmortem

## Per-user identity

The `onMention` handler forwards the **requesting user** (resolved to name +
email where the platform exposes it) to the agent each turn via
`senderContext(message.user)`, so the bot acts on behalf of whoever's asking:
"my issues" is scoped to you, and issues it files are assigned to you. On Slack
this needs the `users:read.email` scope (already in the manifest — reinstall
the app once after adding it).

Caveat: a single API key can't forge Linear's `creator`, so created issues
are _authored_ by the bot and _assigned_ to the requester. True per-user
attribution (and reliable Notion personalization) needs per-user OAuth.

## Files → tables

Upload a file and the bot analyzes it: images and **PDFs** go straight to the
model, and CSV/JSON/text are decoded and handed over as text. The adapter is
transport-only — it downloads the upload and delivers it to the agent as
multimodal content; the **app** (the `render_table` tool above) decides what
to do.

> **PDFs and images need a vision/document-capable model.** The default
> `openai/gpt-5.5` reads both natively through this path, as do recent Claude
> (`anthropic/claude-sonnet-4-6`) and Gemini (`google/gemini-2.5-*`) models.
> An older text-only model will ignore the attached document.

Try it: drop a CSV and say _"show the incidents as a table"_.

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

`pnpm --filter slack-example build` builds `@copilotkit/channels` and
`@copilotkit/runtime`; Nx brings the platform adapters in transitively through
the project graph, so `tsx` runs against fresh `dist`. The **Watch Paths** are
what makes a `packages/**`-only change trigger a redeploy (the example's own
files no longer need to change to provoke one).

> **Copying this example out of the monorepo?** Replace the `workspace:*` ranges
> for `@copilotkit/channels` once version `0.2.0` is published (for example,
> `@copilotkit/channels: ^0.2.0`),
> `@copilotkit/runtime`, and `@copilotkit/channels-intelligence` with appropriate
> published versions. Keep importing platform APIs from the umbrella's subpaths.
> The optional managed gateway entrypoint deliberately imports an internal helper
> from `@copilotkit/channels-intelligence`; it is not part of the curated umbrella
> API. If you do not use that entrypoint, remove it and its dependency instead.

### WhatsApp (inbound webhook, needs a public domain)

Slack and Discord are outbound (Socket Mode / gateway) and need no public
ingress. WhatsApp is different: it adds an inbound webhook HTTP server on
`$PORT`, so the bot service needs a public URL. To enable it on the deployed
bot service (Railway):

1. Generate a public domain on the **bot** service (Settings → Networking).
   Railway routes it to `$PORT`, which the WhatsApp adapter listens on.
2. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_VERIFY_TOKEN` on the bot service (use a System User token — the
   temporary one expires in 24h). The `runtime` service is unchanged.
3. In the Meta app → WhatsApp → Configuration: Callback URL
   `https://<bot-domain>/webhook`, Verify Token = `WHATSAPP_VERIFY_TOKEN`,
   subscribe to the `messages` field.

Health check: `GET https://<bot-domain>/` returns `ok`.

## Feature demos

Two runnable demos extend the on-call triage bot to narrate per-platform degradation explicitly.

### 1. Ephemeral — `/preview <title>`

```
/preview Login button throws 500 on submit
```

Posts a private draft issue card visible only to you — a "here's what I'd file, only you see this" preview — before anything is written to Linear or posted publicly. Run `/file-issue` afterwards to actually file it.

**Source:** `app/commands/index.ts` (`preview` command) using `thread.postEphemeral(user, draft, { fallbackToDM: true })`.

> **Slack setup:** `/preview` must be declared under **Slash Commands** in your Slack app manifest (already present in `slack-app-manifest.yaml`). Slack won't deliver an undeclared command even over Socket Mode.

### 2. Modals — `/file-issue`

```
/file-issue
```

Opens a structured Linear issue form. On Slack you get the full form (title, description text inputs, priority dropdown, type radio). On Discord the form is text-only. On Telegram there is no modal surface, so the bot narrates that and continues conversationally.

On submission (`bot.onModalSubmit("file_issue", …)` in `app/index.ts`), the bot validates the inputs and files the issue via the agent (Linear MCP) with the usual `confirm_write` gate, then shows the filed card.

**Source:** `app/modals/file-issue.tsx` (`FileIssueModal`, `issueFromValues`), `app/commands/index.ts` (`file-issue` command).

> **Slack setup:** `/file-issue` must be declared under **Slash Commands** in your Slack app manifest (already present in `slack-app-manifest.yaml`).

### Per-platform behavior

| Demo                   | Slack                         | Discord                                         | Telegram                              |
| ---------------------- | ----------------------------- | ----------------------------------------------- | ------------------------------------- |
| Ephemeral (`/preview`) | native only-you message       | DM fallback                                     | DM fallback                           |
| Modal (`/file-issue`)  | rich form (dropdowns + radio) | text-only (≤5 inputs; type/priority default in) | unsupported → conversational fallback |

The degradation is always narrated, never silent: `/preview` reports whether it used the DM path; `/file-issue` says "modals aren't supported here" on Telegram and continues in chat.

## Tests

```bash
pnpm --filter slack-example test     # unit tests (read_thread, render tools, components, confirm_write, modals, commands)
```

> **Note:** the live-Slack e2e harness (`pnpm e2e` / `pnpm e2e:restart`) is
> being migrated to the new `createChannel` API — it still targets the old bridge
> and the obsolete button-value resume path, so it does not run against this
> example as-is. The Telegram harness (`pnpm e2e:telegram`) is a working
> manual-trigger smoke test — see [`e2e/TELEGRAM-README.md`](e2e/TELEGRAM-README.md).
