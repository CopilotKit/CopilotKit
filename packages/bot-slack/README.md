# @copilotkit/bot-slack

The **Slack `PlatformAdapter`** for [`@copilotkit/bot`](../bot). It connects a
Slack workspace to any AG-UI agent: ingress via Bolt (Socket Mode), egress as
Block Kit rendered from the `@copilotkit/bot-ui` JSX vocabulary, plus text
streaming, opaque-id interactions, and HITL.

You write your UI as JSX once (`@copilotkit/bot-ui`) and drive the bot with
`@copilotkit/bot`; this package is the only one that talks to Slack.

## Install

```sh
pnpm add @copilotkit/bot-slack @copilotkit/bot @copilotkit/bot-ui
```

## Quickstart

```ts
import { createBot } from "@copilotkit/bot";
import {
  slack,
  defaultSlackTools,
  defaultSlackContext,
} from "@copilotkit/bot-slack";

const bot = createBot({
  adapters: [
    slack({
      botToken: process.env.SLACK_BOT_TOKEN!, // xoxb-…
      appToken: process.env.SLACK_APP_TOKEN!, // xapp-… (Socket Mode)
    }),
  ],
  agent: (threadId) => makeAgent(threadId),
  tools: [...defaultSlackTools, ...appTools], // lookup_slack_user + your tools
  context: [...defaultSlackContext, ...appContext], // tagging/mrkdwn/thread guidance
});

bot.onMention(({ thread }) => thread.runAgent());

await bot.start();
```

`slack(opts)` returns a `SlackAdapter`. By default it runs in **Socket Mode**
(`socketMode: true`) — outbound WebSocket only, no public URL needed. HTTP
mode (`socketMode: false`) needs `signingSecret` and a `port`. The Slack
listener pre-filters ingress to the turns the bot should answer (@-mentions,
replies in threads it owns, DMs), so a single `onMention` handler usually
covers everything.

### Required env

| Var               | Token   | Purpose                          |
| ----------------- | ------- | -------------------------------- |
| `SLACK_BOT_TOKEN` | `xoxb-` | Bot token for the Web API.       |
| `SLACK_APP_TOKEN` | `xapp-` | App-level token for Socket Mode. |

## What it provides

### JSX → Block Kit rendering

`renderSlackMessage(ir)` / `renderBlockKit(ir)` translate the
`@copilotkit/bot-ui` vocabulary to Block Kit: `Message → blocks`,
`Header → header`, `Section → section (mrkdwn)`, `Markdown → markdownToMrkdwn`,
`Field(s) → section.fields`, `Context → context`, `Actions → actions`,
`Button → button (action_id = minted opaque id)`, `Select → static_select`,
`Input → plain_text_input`, `Image → image`, `Divider → divider`.

### Per-element budget

Slack caps every element. The renderer degrades by truncate-with-overflow /
clamp — it never silently drops content. Limits live in `SLACK_LIMITS`:

| Limit              | Value | Element                    |
| ------------------ | ----- | -------------------------- |
| `blocksPerMessage` | 50    | blocks per message         |
| `sectionText`      | 3000  | section body chars         |
| `headerText`       | 150   | header chars               |
| `fieldsPerSection` | 10    | fields per section         |
| `fieldText`        | 2000  | field chars                |
| `actionsElements`  | 25    | controls per actions row   |
| `contextElements`  | 10    | elements per context block |
| `buttonText`       | 75    | button label chars         |
| `actionId`         | 255   | `action_id` chars          |
| `buttonValue`      | 2000  | button value chars         |
| `selectOptions`    | 100   | options per select         |

### Colored cards

`<Message accent="#RRGGBB">` renders as a Slack attachment with a colored
left bar (Block Kit blocks have no native accent, so accented messages are
posted as `attachments: [{ color, blocks }]`).

### Streaming

By default, replies stream via Slack's **native streaming API**
(`chat.startStream` / `appendStream` / `stopStream`) wherever the reply target
is a thread — a true streaming UI rendering **raw markdown** (so real tables and
fenced code render natively), with the same throttle budget and fence-aware
multi-message continuation as the legacy path. Flat DMs (no thread) and any
workspace where the streaming API is unavailable fall back automatically to the
shipped `chat.update` transport (throttled edits, multi-message chunking,
mid-stream bracket auto-close, Markdown → mrkdwn translation). Pass
`streaming: "legacy"` to force the `chat.update` transport everywhere. The
fallback is transparent — **opting in can never break a bot**: the first
`startStream` failure marks the workspace legacy and redoes the stream the old
way.

### Assistant pane (agent-native, default-on)

When the Slack app has the **Agents & AI Apps** toggle (an `assistant_view`
manifest block + the `assistant:write` scope and `assistant_thread_*` events),
the adapter activates Slack's assistant pane with **zero config**:

- Opening the pane posts a greeting + tappable prompt chips, and each pane
  conversation is its own thread (replies stay in-thread).
- While the agent runs, native composer status is shown
  (`assistant.threads.setStatus`: "is thinking…", "is using \`tool\`…") instead
  of placeholder/`:wrench:` messages.
- The pane thread is auto-titled from the first message.

Customize via the `assistant` option, or set `assistant: false` to disable pane
handling entirely. Apps **without** the toggle behave exactly as before — the
pane machinery lies dormant.

```ts
slack({
  botToken,
  appToken,
  assistant: {
    greeting: "Hi! I can triage issues, search docs, and more.",
    suggestedPrompts: [
      { title: "Triage my open issues", message: "Triage my open issues" },
    ],
  },
});

// Dynamic behavior when a user opens the pane (layers on top of the defaults):
bot.onThreadStarted(async ({ thread, user }) => {
  await thread.setSuggestedPrompts(promptsFor(user));
  // await thread.setTitle(...) is also available
});
```

### Interactions (ack-first)

Every Slack `block_actions` click is acked immediately (within the **≤3s**
deadline, `ackDeadlineMs = 3000`), then `decodeInteraction` extracts the
opaque minted id (`ck:…`), any tiny `bind()` value, and the message ref, and
hands an `InteractionEvent` to the engine. The token carries only the opaque
id — no props or secrets. Unrelated clicks decode to events the bot
harmlessly ignores.

### Human-in-the-loop

Use `thread.awaitChoice(<Picker .../>)` to post an interactive message and
block until a click resolves it; the resolved value is the clicked control's
value. Agent interrupts (`on_interrupt`) are captured by the run renderer and
dispatched to your `onInterrupt` handler, which posts a picker; the click
resumes the agent via `thread.resume(value)`.

### Sender-profile resolution & file download

The adapter resolves each turn's Slack user id to a richer `PlatformUser`
(`{ id, name?, email? }`), cached per id. Inbound files can be downloaded and
delivered to the agent as multimodal content parts (`buildFileContentParts`);
a tool can post a file back out via `thread.postFile(...)`.

### Built-ins

- `defaultSlackTools` — ships `lookup_slack_user` so the agent can resolve a
  name/handle/email to a `<@USERID>` mention. Spread into `tools`.
- `defaultSlackContext` — tagging procedure, Markdown-vs-mrkdwn guidance, and
  the Slack thread/DM conversation model. Spread into `context`.

## Tool context

There is no Slack-specific tool context. Tools receive the single shared
`BotToolContext` from `@copilotkit/bot` (`{ thread, message?, user?, signal?,
platform }`) and reach Slack power only through capability-gated `thread`
methods, which this adapter backs:

- `thread.getMessages()` — the current thread's messages (via
  `conversations.replies`), each a `ThreadMessage` (`{ user?, text, ts?,
isBot? }`).
- `thread.lookupUser(query)` — resolve a name/handle/email to a `PlatformUser`.
- `thread.postFile({ bytes, filename, title?, altText? })` — upload a file
  back into the thread (`files.uploadV2`).

This keeps tools portable: define them with `defineBotTool({...})` and they
work against any adapter that advertises the same capabilities.

## Running the demo

This package is the **library**. A runnable end-to-end demo wiring all of the
above against a real workspace lives in
[`examples/slack`](../../examples/slack).

## Slash commands

The adapter forwards every slash command Slack delivers to the engine, which
routes it to the matching `bot.onCommand` handler (and ignores unregistered
ones). Register handlers on the engine — see
[`@copilotkit/bot`](../bot/README.md):

```ts
bot.onCommand({
  name: "triage",
  description: "Summarize the thread and propose issues.",
  async handler({ thread, text, user }) {
    await thread.runAgent({ prompt: `Triage: ${text}` });
  },
});
```

**You must also declare each command in the Slack app config** ("Slash
Commands" / app manifest) with the same name — Slack won't deliver an
unregistered command, even over Socket Mode. Args arrive as free text
(`ctx.text`); the optional `options` schema is for surfaces with native
structured args (e.g. Discord) and is unused on Slack. The adapter does not
implement `registerCommands`, so the engine skips it (Slack matches commands
dynamically rather than registering them up front).

## What's NOT in v1

- Modals / true batched form submit
- OAuth / multi-workspace install (single bot token only)
- Durable (Redis/DB) `ActionStore` — in-memory only; actions expire on
  restart
- Proactive posting (bot replies only to turns it's part of)
- Reactions

## Exports

`slack`, `SlackAdapter`, `SlackAdapterOptions`, `SlackAssistantOptions`;
`createRunRenderer`; `decodeInteraction`, `conversationKeyOf`; `renderBlockKit`,
`renderSlackMessage`, `SLACK_LIMITS`; `defaultSlackTools`,
`lookupSlackUserTool`, `defaultSlackContext` (+ the individual context
entries); `markdownToMrkdwn`; and the
preserved mechanics (`SlackConversationStore`, `MessageStream`,
`ChunkedMessageStream`, `NativeMessageStream`, `attachSlackListener`,
`attachAssistant`, `SanitizingHttpAgent`, `buildFileContentParts`,
`autoCloseOpenMarkdown`, and supporting types).
