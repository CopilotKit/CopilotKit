# @copilotkit/channels-slack

The **Slack `PlatformAdapter`** for [`@copilotkit/channels`](../channels). It connects a
Slack workspace to any AG-UI agent: ingress via Bolt (Socket Mode), egress as
Block Kit rendered from the `@copilotkit/channels-ui` JSX vocabulary, plus text
streaming, opaque-id interactions, and HITL.

You write your UI as JSX once (`@copilotkit/channels-ui`) and drive the bot with
`@copilotkit/channels`; this package is the only one that talks to Slack.

## Install

```sh
pnpm add @copilotkit/channels-slack @copilotkit/channels @copilotkit/channels-ui
```

## Quickstart

```ts
import { createChannel } from "@copilotkit/channels";
import {
  slack,
  defaultSlackTools,
  defaultSlackContext,
} from "@copilotkit/channels-slack";

const bot = createChannel({
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
mode (`socketMode: false`) needs `signingSecret` and a `port`.

Every Slack message becomes a turn — DMs, app mentions, plain thread replies,
and top-level channel chatter alike. What happens next is a **product-driven
response policy**: DMs and the assistant pane are always directly addressed;
a shared channel or thread message is addressed only when the bot is
explicitly @-mentioned (a prior bot reply in that thread does NOT remove the
tagging requirement). An addressed message with no matching `onMention`/
`onMessage` handler auto-runs the agent; an untagged shared message is
ignored UNLESS you register an `onMessage` handler, which opts in to seeing
every untagged channel/thread message too.

### Required env

| Var               | Token   | Purpose                          |
| ----------------- | ------- | -------------------------------- |
| `SLACK_BOT_TOKEN` | `xoxb-` | Bot token for the Web API.       |
| `SLACK_APP_TOKEN` | `xapp-` | App-level token for Socket Mode. |

## Response routing

`respondTo` is a pair of hard **adapter pre-filters** — surfaces you can turn
off before anything reaches the engine. It does NOT decide whether a message
is addressed; that product-driven decision (§2 above) always runs afterward.

| Surface                                 | Pre-filter                                    | What it controls                                                         |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Direct messages (`message.im`)          | `respondTo.directMessages`                    | `false` → never forward DMs at all.                                      |
| App mentions (`app_mention`)            | `respondTo.appMentions` / `appMentions.reply` | `false` → never forward mentions; `reply` picks thread-vs-channel reply. |
| Plain channel/thread replies            | Not gated by `respondTo`                      | Always forwarded; the engine's §2 policy decides.                        |
| Assistant pane                          | Separate default-on API                       | `assistant`; not controlled by `respondTo`.                              |
| Slash commands, reactions, interactions | Explicit trigger paths                        | Not controlled by `respondTo`.                                           |

```ts
// Default routing made explicit.
slack({
  botToken,
  appToken,
  respondTo: {
    directMessages: true,
    appMentions: { reply: "thread" },
  },
});
```

To see every plain, untagged reply in a shared channel/thread (not just
`@mentions`), register an `onMessage` handler — the engine's response policy
opts you in per §2's rules; there is no adapter-level toggle for it anymore.
Subscribe to `message.channels` and `message.groups` (in addition to
`app_mention` and `message.im`) so Slack actually delivers those events.

## What it provides

### JSX → Block Kit rendering

`renderSlackMessage(ir)` / `renderBlockKit(ir)` translate the
`@copilotkit/channels-ui` vocabulary to Block Kit: `Message → blocks`,
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
fenced code render natively). A whole turn streams into **one** message: text
from every step accumulates into a single bubble (Slack documents only a 12k
char limit _per append_, with no cumulative cap, so there is no multi-message
splitting), and tool calls surface as native in-message **`task_update`**
chunks (a "timeline" of `Using …` → `Used …` steps) instead of separate status
messages. Workspaces where structured chunks aren't available degrade
automatically to `:wrench:` status rows.

Flat DMs (no thread) and any workspace where the streaming API is unavailable
fall back automatically to the shipped `chat.update` transport (throttled edits,
multi-message chunking, mid-stream bracket auto-close, Markdown → mrkdwn
translation). Pass `streaming: "legacy"` to force the `chat.update` transport
everywhere. The fallback is transparent — **opting in can never break a bot**:
the first `startStream` failure marks the workspace legacy and redoes the stream
the old way.

### Feedback buttons (opt-in)

Pass `feedback` to attach Slack's native AI feedback row (👍/👎,
`context_actions` + `feedback_buttons`) to each finalized streamed reply. Clicks
are routed straight to your handler — they never reach the engine's interaction
dispatch. Without `feedback`, no buttons are shown.

```ts
slack({
  botToken,
  appToken,
  feedback: {
    onFeedback: ({ sentiment, user, channel, messageTs }) => {
      recordFeedback({ sentiment, user, channel, messageTs }); // your telemetry
    },
    // positiveLabel / negativeLabel are optional
  },
});
```

The row is attached at `chat.stopStream` (the only streaming call that accepts
`blocks`), so it appears on the native path only — the legacy `chat.update`
fallback omits it.

### Native "is thinking…" status (everywhere)

While the agent runs, the bot shows Slack's **native** loading status
(`assistant.threads.setStatus`: "is thinking…") on every thread-anchored reply —
channel @-mentions, threads it owns, DMs, and the assistant pane. Slack now
accepts this method with the ordinary **`chat:write`** scope (no `assistant:write`
needed just for the loading state), so it works for channel-based apps too. The
status auto-clears when the reply streams in. Tool progress is surfaced per
surface: the pane uses live composer status ("is using \`tool\`…"); elsewhere it
uses the native `task_update` timeline (or `:wrench:` rows on older workspaces).
Set `assistant: false` to opt out of the status (and pane) entirely.

### Assistant pane (agent-native, default-on)

When the Slack app has the **Agents & AI Apps** toggle (an `assistant_view`
manifest block + the `assistant:write` scope and `assistant_thread_*` events),
the adapter activates Slack's assistant pane with **zero config**:

- Opening the pane posts a greeting + tappable prompt chips, and each pane
  conversation is its own thread (replies stay in-thread).
- While the agent runs, native composer status is shown (see above), with
  "is using \`tool\`…" per tool call.
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
`ChannelToolContext` from `@copilotkit/channels` (`{ thread, message?, user?, signal?,
platform }`) and reach Slack power only through capability-gated `thread`
methods, which this adapter backs:

- `thread.getMessages()` — the current thread's messages (via
  `conversations.replies`), each a `ThreadMessage` (`{ user?, text, ts?,
isBot? }`).
- `thread.lookupUser(query)` — resolve a name/handle/email to a `PlatformUser`.
- `thread.postFile({ bytes, filename, title?, altText? })` — upload a file
  back into the thread (`files.uploadV2`).

This keeps tools portable: define them with `defineChannelTool({...})` and they
work against any adapter that advertises the same capabilities.

## Running the demo

This package is the **library**. A runnable end-to-end demo wiring all of the
above against a real workspace lives in
[`examples/slack`](../../examples/slack).

## Slash commands

The adapter forwards every slash command Slack delivers to the engine, which
routes it to the matching `bot.onCommand` handler (and ignores unregistered
ones). Register handlers on the engine — see
[`@copilotkit/channels`](../channels/README.md):

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

## OAuth bot scopes

The following bot token scopes are required or relevant depending on the
features your app uses:

| Scope              | Required for                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `chat:write`       | Posting messages, streaming, ephemeral messages (`chat.postEphemeral`), and opening modals (`views.open`) — all share this single scope. |
| `reactions:read`   | Reading reactions; subscribe to `reaction_added` / `reaction_removed` events in the app manifest to receive them.                        |
| `reactions:write`  | Adding or removing reactions via `reactions.add` / `reactions.remove`.                                                                   |
| `assistant:write`  | Native streaming `task_update` tool-timeline chunks and the assistant pane. (The "is thinking…" status works with `chat:write` alone.)   |
| `files:write`      | Uploading files via `thread.postFile()`.                                                                                                 |
| `users:read`       | Resolving Slack user profiles (name, email) via `users.info`.                                                                            |
| `users:read.email` | Resolving user email addresses.                                                                                                          |
| `channels:history` | Reading channel thread messages via `conversations.replies`.                                                                             |
| `groups:history`   | Reading private-channel thread messages via `conversations.replies`.                                                                     |
| `im:history`       | Reading DM thread messages via `conversations.replies`.                                                                                  |
| `mpim:history`     | Reading group-DM thread messages via `conversations.replies`.                                                                            |

### Notes

- **Modals** (`views.open`, `view_submission`, `view_closed`): handled via
  `chat:write` — no additional scope is needed.
- **Ephemeral messages** (`chat.postEphemeral`): covered by `chat:write`.
- **Reactions** (`reactions:read` / `reactions:write`): these scopes alone
  are not enough — you must also subscribe to the `reaction_added` and
  `reaction_removed` events in the Slack app manifest so that Slack delivers
  the events to your bot.

## What's NOT in v1

- OAuth / multi-workspace install (single bot token only)
- Durable (Redis/DB) `ActionStore` — in-memory only; actions expire on
  restart
- Proactive posting (bot replies only to turns it's part of)

## Exports

`slack`, `SlackAdapter`, `SlackAdapterOptions`, `SlackAssistantOptions`,
`SlackRespondToOptions`;
`createRunRenderer`; `decodeInteraction`, `conversationKeyOf`; `renderBlockKit`,
`renderSlackMessage`, `SLACK_LIMITS`; `defaultSlackTools`,
`lookupSlackUserTool`, `defaultSlackContext` (+ the individual context
entries); `markdownToMrkdwn`; and the
preserved mechanics (`SlackConversationStore`, `MessageStream`,
`ChunkedMessageStream`, `NativeMessageStream`, `attachSlackListener`,
`attachAssistant`, `SanitizingHttpAgent`, `buildFileContentParts`,
`autoCloseOpenMarkdown`, and supporting types).
