# OpenTag — a multi-platform bot starter (Slack · Discord · Telegram)

The clean **"how to get started with CopilotKit bots"** starter. OpenTag is a
thread-tagging assistant: @mention it (or run `/tag`) in a thread and it reads
the conversation, proposes a label (`bug` / `question` / `feature` / `docs` /
`urgent`), and — after you click **Apply** — posts the tag as a rich card.

It's built with [`@copilotkit/bot`](../../packages/bot) (the platform-agnostic
bot engine), one or more platform adapters
([`-slack`](../../packages/bot-slack) /
[`-discord`](../../packages/bot-discord) /
[`-telegram`](../../packages/bot-telegram)), and
[`@copilotkit/bot-ui`](../../packages/bot-ui) (a cross-platform JSX vocabulary
for rich messages). It's the distilled sibling of
[`examples/slack`](../slack) — the same engine and patterns, minus the kitchen
sink (no MCP, no modals, no charts).

**One app, any platform — or all at once.** `createBot` takes an array of
adapters; `app/index.ts` includes Slack when `SLACK_*` are set, Discord when
`DISCORD_*` are set, and Telegram when `TELEGRAM_BOT_TOKEN` is set. Everything
in `app/` is platform-agnostic and shared verbatim.

## What it teaches

In ~250 lines of `app/`, OpenTag shows the whole shape of a CopilotKit bot:

| Concept                                                                           | Where                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `createBot({ adapters, agent, tools, context, commands })`, secret-gated adapters | `app/index.ts`                                          |
| The core turn loop — `bot.onMention` → `thread.runAgent()`                        | `app/index.ts`                                          |
| A `BotTool` that grounds the agent in the real conversation                       | `app/tools/read-thread.ts`                              |
| A generative-UI **render-tool** + JSX component                                   | `app/tools/tag-card.tsx`, `app/components/tag-card.tsx` |
| A blocking **human-in-the-loop** gate (`thread.awaitChoice`)                      | `app/human-in-the-loop/confirm-tag.tsx`                 |
| A slash command (`/tag`)                                                          | `app/commands/index.ts`                                 |
| The agent backend — one `BuiltInAgent` (LLM, no MCP) over AG-UI                   | `runtime.ts`                                            |

## Quickstart

> **Coming soon:** `npx copilotkit create --framework opentag` will scaffold a
> standalone copy in one command. Until that lands, run it from the monorepo:

```bash
# from the repo root
pnpm install
cp examples/opentag/.env.example examples/opentag/.env
# …fill in secrets (see below), then in two terminals:
pnpm --filter opentag runtime     # the agent backend on :8200
pnpm --filter opentag dev         # the bot (tsx watch app/index.ts)
```

You need an `OPENAI_API_KEY` and the secrets for **at least one** platform.

## How it fits together

```
Slack / Discord / Telegram ──@mention──▶ bot (app/) ──AG-UI──▶ runtime (runtime.ts)
                                                                  └─ BuiltInAgent (LLM)
```

- **`app/`** — the platform-agnostic bot: `createBot` + whichever adapters have
  secrets, the `read_thread` / `tag_card` tools, the `confirm_tag` HITL gate,
  and the `/tag` command. **This is the directory you copy to start your own
  bot.**
- **`runtime.ts`** — the agent backend: a single CopilotKit `BuiltInAgent`
  (an LLM) served over AG-UI. No Python, no LangGraph, no external services.

## 1. Set up a platform

Set the secrets for whichever platform(s) you want — the bot starts an adapter
for each one whose secrets are present.

### Slack (set `SLACK_*`)

- <https://api.slack.com/apps?new_app=1> → **From a manifest** → paste
  [`slack-app-manifest.yaml`](./slack-app-manifest.yaml).
- _OAuth & Permissions_ → **Install to Workspace** → copy the `xoxb-` bot token
  (`SLACK_BOT_TOKEN`).
- _Basic Information → App-Level Tokens_ → generate one with `connections:write`
  → copy the `xapp-` token (`SLACK_APP_TOKEN`).

The manifest declares the `/tag` command, the assistant pane, and Socket Mode
(so no public URL is needed).

### Discord (set `DISCORD_*`)

- <https://discord.com/developers/applications> → **New Application**.
- **Bot** → copy the token (`DISCORD_BOT_TOKEN`); under **Privileged Gateway
  Intents** enable **both** **Message Content** and **Server Members**.
- **General Information** → copy the **Application ID** (`DISCORD_APP_ID`).
- **OAuth2 → URL Generator** → scopes `bot` + `applications.commands` → open the
  URL to add it to your server. Optionally set `DISCORD_GUILD_ID` so slash
  commands register instantly during dev.

### Telegram (set `TELEGRAM_BOT_TOKEN`)

- Message **@BotFather** → `/newbot` → copy the HTTP API token
  (`TELEGRAM_BOT_TOKEN`). Long-polling is the default — no public URL needed.
- The bot auto-registers `/tag` via `setMyCommands` on start.

## 2. Run it

```bash
cp .env.example .env       # then fill in OPENAI_API_KEY + your platform secrets
pnpm --filter opentag runtime   # terminal 1 — agent on :8200
pnpm --filter opentag dev       # terminal 2 — the bot
```

## 3. Try it

@mention the bot in a thread (Slack/Discord) or DM it (Telegram), or run `/tag`:

> @OpenTag tag this thread

OpenTag reads the thread, proposes a label with a one-line rationale, and shows
an **Apply / Cancel** card. Click **Apply** and it posts the applied tag.

## Code walkthrough

### The bot (`app/index.ts`)

`createBot` takes the adapters that have secrets, the bot's tools + context, and
the `/tag` command. One `onMention` handler covers @mentions and DMs on every
active platform:

```ts
bot.onMention(async ({ thread, message }) => {
  await thread.runAgent({
    context: senderContext(message.user, thread.platform),
  });
});
```

### The tagging flow (tools + HITL)

The system prompt (`runtime.ts`) steers a strict order: **read → confirm →
apply.**

1. `read_thread` — fetches the conversation via `thread.getMessages()` so the
   agent tags what was actually said.
2. `confirm_tag` — posts an Apply/Cancel card and **blocks** on
   `thread.awaitChoice(...)`, returning `{ confirmed }`. Applying a tag is a
   write, so the agent may never skip this.
3. `tag_card` — only after approval, renders the `<TagCard>` component to show
   the applied tag.

```tsx
// the human-in-the-loop gate, in app/human-in-the-loop/confirm-tag.tsx
async handler({ label, rationale }, { thread }) {
  const choice = await thread.awaitChoice<{ confirmed?: boolean }>(
    <ConfirmTag label={label} rationale={rationale} />,
  );
  return choice?.confirmed
    ? "The user APPROVED — apply the tag now by calling tag_card."
    : "The user DECLINED — do not apply the tag; acknowledge briefly and stop.";
}
```

### The agent (`runtime.ts`)

A single CopilotKit `BuiltInAgent` (LLM, no MCP) served over AG-UI by a
`CopilotSseRuntime`. The default model is `openai/gpt-5.5` (override with
`AGENT_MODEL`). The bot's tools (`read_thread`, `confirm_tag`, `tag_card`) are
forwarded to the agent on every run as client-side tools.

## Make it yours

- **Apply tags for real.** Today the "apply" is visual — the seam is the
  `tag_card` tool handler in `app/tools/tag-card.tsx` (and the approval branch
  in `confirm-tag.tsx`). Call your own system there: a GitHub Issues label, a
  Linear update, a row in your DB.
- **Change the taxonomy.** Edit the label list in the `runtime.ts` system prompt
  and the colors in `app/components/tag-card.tsx`.
- **Add a platform.** Add another adapter to the secret-gated block in
  `app/index.ts` (e.g. `@copilotkit/bot-whatsapp`).
- **Durable buttons.** Pass a `@copilotkit/bot-store-redis` store to `createBot`
  so an Apply/Cancel click still resolves after a restart.

## Tests

```bash
pnpm --filter opentag test         # unit tests: read_thread, tag_card, confirm_tag
pnpm --filter opentag check-types  # tsc --noEmit
```

## Copying this out of the monorepo

This example consumes the `@copilotkit/*` packages via `workspace:*`, so it
builds from in-repo source. To run it standalone, replace those ranges in
`package.json` with the published versions (e.g.
`"@copilotkit/bot-slack": "^0.1.0"`) — `workspace:*` only resolves inside this
monorepo.
