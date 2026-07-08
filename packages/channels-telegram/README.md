# @copilotkit/channels-telegram

The **Telegram `PlatformAdapter`** for [`@copilotkit/channels`](../channels). It connects
a Telegram bot to any AG-UI agent: ingress via grammY (long-polling or webhook),
egress as Telegram HTML rendered from the `@copilotkit/channels-ui` JSX vocabulary,
plus streaming via chunked message edits, opaque-id interactions, and HITL.

You write your UI as JSX once (`@copilotkit/channels-ui`) and drive the bot with
`@copilotkit/channels`; this package is the only one that talks to Telegram.

## Install

```sh
pnpm add @copilotkit/channels-telegram @copilotkit/channels @copilotkit/channels-ui
```

## Quickstart

> **File must be `.tsx`** — JSX in TypeScript requires the JSX factory to be
> configured. Point it at `@copilotkit/channels-ui` in your `tsconfig.json`:
>
> ```json
> {
>   "compilerOptions": {
>     "jsx": "react-jsx",
>     "jsxImportSource": "@copilotkit/channels-ui"
>   }
> }
> ```

```tsx
import { createBot } from "@copilotkit/channels";
import {
  telegram,
  defaultTelegramTools,
  defaultTelegramContext,
} from "@copilotkit/channels-telegram";
import { Message, Section } from "@copilotkit/channels-ui";

const bot = createBot({
  adapters: [
    telegram({
      token: process.env.TELEGRAM_BOT_TOKEN!,
    }),
  ],
  agent: (threadId) => makeAgent(threadId),
  tools: [...defaultTelegramTools, ...appTools], // lookup_telegram_user + your tools
  context: [...defaultTelegramContext, ...appContext], // tagging/HTML/thread guidance
});

bot.onMention(({ thread }) => thread.runAgent());

// Optional: greet users when they start a DM
bot.onThreadStarted(async ({ thread }) => {
  await thread.post(
    <Message>
      <Section>Hi! How can I help?</Section>
    </Message>,
  );
});

await bot.start();
```

`telegram(opts)` returns a `TelegramAdapter`. By default it runs in
**long-polling** mode — no public URL needed. Set `mode: "webhook"` (with
`webhook.domain`) to receive updates via HTTP, or `mode: "auto"` to let the
adapter pick based on environment variables (prefers webhook in Vercel/Lambda
environments, falls back to polling).

### Required env

| Var                  | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather (e.g. `123:ABC-xyz`) |

## What it provides

### JSX → Telegram HTML rendering + limits

`renderTelegram(ir)` translates the `@copilotkit/channels-ui` vocabulary to a
Telegram Bot API payload (`text`, `parseMode: "HTML"`, optional
`inlineKeyboard`, optional `photos`): `Message → container`, `Header → <b>`,
`Section/Markdown → telegramHtml()`, `Field(s) → <b>label</b> value`,
`Context → <i>`, `Actions → inline keyboard rows`, `Select → inline keyboard
rows`, `Image → photo`, `Table → <pre> monospace grid`, `Divider → ──────`.

Telegram API limits are enforced via `TELEGRAM_LIMITS` and the helpers:

| Limit               | Value | Element                         |
| ------------------- | ----- | ------------------------------- |
| `messageText`       | 4096  | characters per message          |
| `caption`           | 1024  | caption characters              |
| `callbackData`      | 64    | bytes per callback_data         |
| `buttonsPerRow`     | 8     | buttons per inline keyboard row |
| `buttonsPerMessage` | 100   | total inline keyboard buttons   |
| `buttonText`        | 64    | button label characters         |
| `photosPerMessage`  | 10    | photos per message              |

### Streaming via chunked edits

Replies stream through `ChunkedEditStream`: the adapter posts a placeholder
message and edits it as tokens arrive, throttled to one edit per second. When a
reply approaches Telegram's 4 096-char limit (~4 000 characters) the stream
transparently mints a second message and continues — keeping each Telegram
message within limits with no reflow of already-frozen chunk boundaries.

### Interactions (ack-first)

Every Telegram `callback_query` (inline keyboard button click) is acked
promptly via `answerCallbackQuery` — the adapter's `ackDeadlineMs` is 3 s so
the client spinner clears quickly, well within Telegram's ~30 s validity
window for `answerCallbackQuery`. After acking, `decodeInteraction` extracts
the conversation key and minted opaque id and hands an `InteractionEvent` to
the engine. Unrelated clicks decode to events the bot harmlessly ignores.

### HITL via ActionStore

Use `thread.awaitChoice(<Picker .../>)` to post an interactive inline keyboard
and block until a click resolves it; the resolved value is the clicked button's
callback data. Agent interrupts (`on_interrupt`) are captured by the run renderer
and dispatched to your `onInterrupt` handler, which posts a picker; the click
resumes the agent via `thread.resume(value)`.

### `/start` → `onThreadStarted`

The listener intercepts the Telegram `/start` command in private chats and
fires `onThreadStarted`, letting the bot post a greeting or configure the
conversation before the first turn.

### Files in/out

Inbound file attachments (photos, audio, video, documents) can be downloaded
and delivered to the agent as multimodal AG-UI content parts via
`buildFileContentParts`. The adapter can post files back out via
`thread.postFile({ bytes, filename })` (sends as a `document`).

### Built-ins

- `defaultTelegramTools` — ships `lookup_telegram_user` so the agent can
  resolve a public `@username` handle to a Telegram user id for @-mentions.
  The tool calls `getChat` with the supplied query and only works for public
  `@username` handles; arbitrary display-name queries are not supported and
  return undefined. Spread into `tools`.
- `defaultTelegramContext` — tagging procedure, Markdown-vs-HTML guidance, and
  the Telegram DM / forum-topic / group-per-user conversation model. Spread into
  `context`.

### Commands via `setMyCommands`

`registerCommands(specs)` calls `bot.api.setMyCommands`, registering the
command menu visible in the Telegram UI. The listener forwards every bot
command to the engine's `onCommand` handlers.

## Ingress modes

| Mode      | How it works                                                                     |
| --------- | -------------------------------------------------------------------------------- |
| `polling` | **Default.** grammY long-polling. No public URL needed.                          |
| `webhook` | grammY webhook + minimal Node HTTP server. Requires `webhook.domain`.            |
| `auto`    | Webhook when `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME`/`NETLIFY` is set, else polling. |

## Reactions

`message_reaction` updates are enabled automatically. The adapter exports
`TELEGRAM_ALLOWED_UPDATES` (the full update-type list it subscribes to) and
passes it to grammY's long-polling `start()` call.

**Group chats:** the bot must be an **administrator** to receive
`message_reaction` events. Private chats and channels work without any
extra permissions.

**Webhook deployments:** pass the same list to `setWebhook`:

```ts
import { TELEGRAM_ALLOWED_UPDATES } from "@copilotkit/channels-telegram";

await bot.api.setWebhook(url, {
  allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
});
```

## What's NOT in v1

- **Modals / native form submit** — Telegram has no modal surface; multi-step
  forms must be conversation-driven. `openModal` resolves `{ ok: false }` on
  this adapter — the engine gates the method off because `supportsModals` is
  `false`.
- **Native ephemeral messages** — Telegram has no per-user-visible messages;
  `supportsEphemeral` is `false`. Use `thread.postEphemeral(user, ui, { fallbackToDM: true })`
  to send a private DM as a fallback instead. **DMing requires the user to have
  previously started a DM with the bot** (sent it at least one message directly);
  if they have not, the DM `sendMessage` call will fail and `postEphemeral`
  resolves `{ ok: false }` rather than throwing.
- **Native streaming** — Telegram has no server-push streaming; streaming is
  approximated via throttled `editMessageText` calls.
- **Durable (Redis/DB) conversation store** — `TelegramConversationStore` is
  in-memory; sessions and message history are lost on restart.
- **Multi-bot install** — one bot token per adapter instance.
- **`<Select>` option-value round-trip** — Telegram `callback_data` is limited
  to 64 bytes. If an option's `value` or `id` serializes to more than 64 bytes
  the renderer silently drops (degrades) that option — the button simply does
  not appear in the keyboard. Use short `id` strings on `<Option>` elements
  when option values are large objects.

## Known limitations

- **Group conversation model** — in ordinary (non-forum) group chats the bot
  keys each conversation per-user-per-group (`user:<userId>`): each member's
  @mentions form one ongoing conversation for that user, and button clicks
  resolve to the clicking user's conversation. The bot does **not** maintain
  a single shared group thread. Forum supergroups use per-topic threads
  (`topic:<threadId>`); DMs are a single flat conversation (`dm`).
- **`update()` does not change media** — editing a previously-posted message
  via `thread.update(ref, ir)` calls `editMessageText` and updates text plus
  inline keyboard only. Photos attached to the original message are not
  changed.
- **Inbound files** — file attachments (photos, audio, video, documents) are
  downloaded and delivered to the agent as multimodal AG-UI content parts.
  Large files that exceed Telegram's size cap for `getFile` are skipped with
  a note in their place.
- **`lookup_telegram_user` is `@username`-only** — the tool resolves public
  `@username` handles by calling `getChat`. Queries that do not start with
  `@` return undefined immediately; arbitrary display-name or real-name
  searches are not supported.
- **Group HITL (interactive buttons) are per-user** — because non-forum group
  conversations are keyed per sender, an inline-keyboard prompt posted for one
  user is only resolved when _that_ user clicks it. A different group member
  clicking the same button is acked but does not resolve the original user's
  pending choice.
- **Concurrency** — the in-memory conversation store does not serialize
  concurrent turns for the same conversation. Rapid back-to-back messages in
  one conversation may interleave. This is acceptable for typical use; a
  durable/locking store is out of v1 scope.

## Exports

`telegram`, `TelegramAdapter`, `TelegramAdapterOptions`;
`createRunRenderer`, `CreateRunRendererArgs`;
`decodeInteraction`, `conversationKeyOf`, `deriveConversationKey`, `toPlatformUser`;
`renderTelegram`; `TELEGRAM_LIMITS`, `truncateText`, `clampArray`, `byteLen`;
`defaultTelegramTools`, `lookupTelegramUserTool`;
`defaultTelegramContext`, `telegramTaggingContext`, `telegramFormattingContext`,
`telegramConversationModelContext`;
`telegramHtml`, `escapeHtml`; `withTelegramFormatFallback`, `stripHtml`;
`TelegramConversationStore`; `ChunkedEditStream`, `ChunkedEditStreamConfig`;
`attachTelegramListener`, `ListenerConfig`;
`buildFileContentParts`, `TelegramFileRef`, `AgentContentPart`, `FileDeliveryConfig`;
types: `ConversationKey`, `ReplyTarget`, `TelegramMessageRef`, `TelegramInlineButton`,
`TelegramPayload`; value `DM_SCOPE`.
