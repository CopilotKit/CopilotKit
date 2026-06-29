# OpenTag — a Slack bot starter

The clean **"how to get started with CopilotKit bots"** starter. OpenTag is a
thread-tagging assistant for **Slack**: @mention it (or run `/tag`) in a thread
and it reads the conversation, proposes a label (`bug` / `question` / `feature`
/ `docs` / `urgent`), and — after you click **Apply** — posts the tag as a rich
card.

It's built with [`@copilotkit/bot`](../../packages/bot) (the platform-agnostic
bot engine), the [`-slack`](../../packages/bot-slack) adapter, and
[`@copilotkit/bot-ui`](../../packages/bot-ui) (a cross-platform JSX vocabulary
for rich messages). It's the distilled sibling of [`examples/slack`](../slack)
— the same engine and patterns, minus the kitchen sink (no MCP, no modals, no
charts).

The engine is platform-agnostic, so the same `app/` runs on Discord, Telegram,
WhatsApp, or Teams by swapping one import — see
[Run it elsewhere](#run-it-elsewhere). This starter keeps the focus on Slack so
there's exactly one path to follow.

## What it teaches

In ~250 lines of `app/`, OpenTag shows the whole shape of a CopilotKit bot:

| Concept                                                         | Where                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| `createBot({ adapters, agent, tools, context, commands })`      | `app/index.ts`                                          |
| The core turn loop — `bot.onMention` → `thread.runAgent()`      | `app/index.ts`                                          |
| A `BotTool` that grounds the agent in the real conversation     | `app/tools/read-thread.ts`                              |
| A generative-UI **render-tool** + JSX component                 | `app/tools/tag-card.tsx`, `app/components/tag-card.tsx` |
| A blocking **human-in-the-loop** gate (`thread.awaitChoice`)    | `app/human-in-the-loop/confirm-tag.tsx`                 |
| A slash command (`/tag`)                                        | `app/commands/index.ts`                                 |
| The agent backend — one `BuiltInAgent` (LLM, no MCP) over AG-UI | `runtime.ts`                                            |

## Quickstart

> **Coming soon:** `npx copilotkit create --framework opentag` will scaffold a
> standalone copy in one command. Until that lands, run it from the monorepo:

```bash
# from the repo root
pnpm install
cp examples/opentag/.env.example examples/opentag/.env
# …fill in OPENAI_API_KEY + your Slack tokens (see below), then in two terminals:
pnpm --filter opentag runtime     # the agent backend on :8200
pnpm --filter opentag dev         # the bot (tsx watch app/index.ts)
```

## How it fits together

```
Slack ──@mention──▶ bot (app/) ──AG-UI──▶ runtime (runtime.ts)
                                            └─ BuiltInAgent (LLM)
```

- **`app/`** — the bot: `createBot` + the Slack adapter, the `read_thread` /
  `tag_card` tools, the `confirm_tag` HITL gate, and the `/tag` command. **This
  is the directory you copy to start your own bot.**
- **`runtime.ts`** — the agent backend: a single CopilotKit `BuiltInAgent`
  (an LLM) served over AG-UI. No Python, no LangGraph, no external services.

## 1. Set up Slack

- <https://api.slack.com/apps?new_app=1> → **From a manifest** → paste
  [`slack-app-manifest.yaml`](./slack-app-manifest.yaml).
- _OAuth & Permissions_ → **Install to Workspace** → copy the `xoxb-` bot token
  (`SLACK_BOT_TOKEN`).
- _Basic Information → App-Level Tokens_ → generate one with `connections:write`
  → copy the `xapp-` token (`SLACK_APP_TOKEN`).

The manifest declares the `/tag` command, the assistant pane, and Socket Mode
(so no public URL is needed).

## 2. Run it

```bash
cp .env.example .env       # then fill in OPENAI_API_KEY + your Slack tokens
pnpm --filter opentag runtime   # terminal 1 — agent on :8200
pnpm --filter opentag dev       # terminal 2 — the bot
```

## 3. Try it

@mention the bot in a Slack thread, or run `/tag`:

> @OpenTag tag this thread

OpenTag reads the thread, proposes a label with a one-line rationale, and shows
an **Apply / Cancel** card. Click **Apply** and it posts the applied tag.

## Code walkthrough

### The bot (`app/index.ts`)

`createBot` takes the Slack adapter, the bot's tools + context, and the `/tag`
command. One `onMention` handler covers @mentions and DMs:

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
- **Durable buttons.** Pass a `@copilotkit/bot-store-redis` store to `createBot`
  so an Apply/Cancel click still resolves after a restart.

## Run it elsewhere

The engine is platform-agnostic — everything in `app/` is shared verbatim across
surfaces. To run OpenTag on another platform, swap the Slack adapter in
`app/index.ts` for another one and provide that platform's secrets:

| Platform | Package                                                   |
| -------- | --------------------------------------------------------- |
| Discord  | [`@copilotkit/bot-discord`](../../packages/bot-discord)   |
| Telegram | [`@copilotkit/bot-telegram`](../../packages/bot-telegram) |
| WhatsApp | [`@copilotkit/bot-whatsapp`](../../packages/bot-whatsapp) |
| Teams    | [`@copilotkit/bot-teams`](../../packages/bot-teams)       |

```ts
// e.g. Discord instead of Slack — the rest of app/ is unchanged
import {
  discord,
  defaultDiscordTools,
  defaultDiscordContext,
} from "@copilotkit/bot-discord";

const adapter = discord({
  botToken: required("DISCORD_BOT_TOKEN"),
  appId: required("DISCORD_APP_ID"),
});
```

`createBot` also accepts **multiple** adapters at once (`adapters: [slack(...),
discord(...)]`) to run one bot across several platforms from a single process.
For a fuller multi-platform, MCP-backed example, see
[`examples/slack`](../slack).

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
