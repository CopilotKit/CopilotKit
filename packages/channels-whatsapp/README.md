# @copilotkit/channels-whatsapp

The **WhatsApp `PlatformAdapter`** for [`@copilotkit/channels`](../channels). It connects a
WhatsApp Business number to any AG-UI agent: ingress via the Meta Cloud API webhook,
egress as text or interactive messages rendered from the `@copilotkit/channels-ui` JSX
vocabulary, opaque-id interactions, and HITL.

You write your UI as JSX once (`@copilotkit/channels-ui`) and drive the bot with
`@copilotkit/channels`; this package is the only one that talks to the WhatsApp Cloud API.

## Install

```sh
pnpm add @copilotkit/channels @copilotkit/channels-whatsapp
```

## Quickstart

```ts
import { createBot } from "@copilotkit/channels";
import {
  whatsapp,
  defaultWhatsAppContext,
} from "@copilotkit/channels-whatsapp";

const bot = createBot({
  adapters: [
    whatsapp({
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
      appSecret: process.env.WHATSAPP_APP_SECRET!,
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
      port: 3000,
    }),
  ],
  agent: makeAgent(process.env.AGENT_URL!),
  tools: [...appTools],
  context: [...defaultWhatsAppContext, ...appContext],
});

// Every inbound text is for the bot — there is no @-mention concept on WhatsApp.
bot.onMessage(async ({ thread }) => {
  await thread.runAgent();
});

await bot.start();
console.log("[whatsapp-bot] listening for webhooks");
```

`whatsapp(opts)` returns a `WhatsAppAdapter`. It starts an HTTP server on `port`
(default 3000) that handles the Meta webhook: a `GET /webhook` verification
handshake and signed `POST /webhook` event delivery. You must expose this port
publicly (e.g. via ngrok) and register the URL + `verifyToken` in the Meta app
configuration. See [`examples/whatsapp`](../../examples/whatsapp) for a complete
setup walkthrough.

### Required env

| Var                        | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `WHATSAPP_ACCESS_TOKEN`    | Cloud API access token (Bearer), from Meta App → API setup. |
| `WHATSAPP_PHONE_NUMBER_ID` | Business phone-number id that sends messages.               |
| `WHATSAPP_APP_SECRET`      | App secret for `X-Hub-Signature-256` webhook validation.    |
| `WHATSAPP_VERIFY_TOKEN`    | Token echoed during the GET verification handshake.         |

## Capabilities

| Capability          | Supported | Notes                                                          |
| ------------------- | --------- | -------------------------------------------------------------- |
| `supportsStreaming` | false     | WhatsApp messages are immutable; there is no edit-message API. |
| `supportsModals`    | false     | No modal surface in the Cloud API.                             |
| `supportsTyping`    | false     | No typing-indicator API for business accounts.                 |
| `supportsReactions` | false     | No reaction API for business-sent messages.                    |

Because messages are immutable, `thread.stream(...)` buffers the full iterable
and sends it as a single message — there is no token-by-token streaming. Calls to
`update` and `delete` are also no-ops (they post a new message instead, or silently
drop). The `defaultWhatsAppContext` entry tells the agent about this constraint so
it doesn't promise to "update this message."

## `WhatsAppAdapterOptions` reference

| Option                | Type                  | Default                        | Description                                                         |
| --------------------- | --------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `accessToken`         | `string`              | required                       | Cloud API access token (Bearer).                                    |
| `phoneNumberId`       | `string`              | required                       | Business phone-number id that sends messages.                       |
| `appSecret`           | `string`              | required                       | App secret for `X-Hub-Signature-256` webhook validation.            |
| `verifyToken`         | `string`              | required                       | Token echoed during the GET verification handshake.                 |
| `port`                | `number`              | `3000`                         | HTTP server port.                                                   |
| `path`                | `string`              | `"/webhook"`                   | Webhook path.                                                       |
| `apiVersion`          | `string`              | `"v21.0"`                      | Graph API version.                                                  |
| `graphBaseUrl`        | `string`              | `"https://graph.facebook.com"` | Graph API base origin. Overridable for tests.                       |
| `interruptEventNames` | `ReadonlySet<string>` | `undefined`                    | Custom AG-UI event names treated as interrupts by the run renderer. |
| `commandPrefix`       | `string`              | `"/"`                          | Prefix for leading-keyword command matching.                        |
| `historyStore`        | `HistoryStore`        | `new InMemoryHistoryStore()`   | Pluggable conversation-history persistence.                         |
| `files`               | `FileDeliveryConfig`  | `{}`                           | Inbound media handling configuration.                               |

## JSX → WhatsApp rendering

`renderWhatsAppMessage(ir)` lowers the `@copilotkit/channels-ui` IR to Cloud API
payloads. The strategy:

- **0 actions** → plain `text` message (markdown converted to WhatsApp formatting).
- **1–3 button actions** → interactive `button` message (reply buttons).
- **4–10 actions** → interactive `list` message (list picker).
- **>10 actions** → numbered text menu (degraded fallback).

Image nodes always emit their own `image` payload. Markdown is translated to
WhatsApp formatting: `**bold**`, `_italic_`, `~~strikethrough~~`, `` `code` ``, and
code blocks. Headings, tables, and clickable Markdown links are not supported on
WhatsApp — links render as plain text.

### Per-element budget

WhatsApp caps interactive elements. Limits live in `WA_LIMITS`:

| Limit               | Value | Element                                          |
| ------------------- | ----- | ------------------------------------------------ |
| `bodyText`          | 4096  | text message body chars                          |
| `replyButtons`      | 3     | reply buttons in an interactive button message   |
| `buttonTitle`       | 20    | reply-button title chars                         |
| `interactiveBody`   | 1024  | interactive message body chars                   |
| `interactiveHeader` | 60    | interactive header chars                         |
| `interactiveFooter` | 60    | interactive footer chars                         |
| `listRows`          | 10    | total rows across all sections in a list message |
| `rowTitle`          | 24    | list-row title chars                             |
| `rowDescription`    | 72    | list-row description chars                       |
| `listButton`        | 20    | list open-button label chars                     |
| `controlId`         | 256   | interactive control id chars                     |

## Persistence

### ActionStore (interaction rehydration)

The engine's `ActionStore` (from `@copilotkit/channels`) stores the minted opaque ids
that power `Button` / `Select` click handlers. By default it is in-memory: after a
process restart, clicks on old interactive messages are acknowledged but ignored.
For persistent interactions, pass a durable `ActionStore` to
`createBot({ actionStore })`.

### HistoryStore (conversation memory)

Unlike Slack, WhatsApp exposes no readable message history. The adapter maintains
its own `HistoryStore` and replays it into `agent.messages` on every turn. The
default is `InMemoryHistoryStore` (up to 100 messages per conversation, drops
oldest). Swap a durable backend by implementing the `HistoryStore` interface:

```ts
interface HistoryStore {
  append(conversationKey: string, message: StoredMessage): Promise<void>;
  read(conversationKey: string): Promise<StoredMessage[]>;
}
```

Pass it as `historyStore` in the adapter options:

```ts
whatsapp({
  // ...
  historyStore: new MyRedisHistoryStore(),
});
```

Without a durable `HistoryStore`, conversation history is lost on process restart.

## Commands

Commands are matched by a leading keyword in the message text (default prefix `/`).
Register handlers with `bot.onCommand`:

```ts
bot.onCommand("status", async ({ thread, text }) => {
  await thread.runAgent({ prompt: `Status check: ${text}` });
});
```

Unlike Slack, WhatsApp has no native slash-command surface — commands are plain
text messages that start with the prefix. They are NOT pre-filtered by the adapter
(the engine matches them), and command messages are not persisted to the
`HistoryStore` at ingress. Sent commands need to be serialized into the agent prompt
explicitly if the agent needs to see them as history.

## Built-ins

- `defaultWhatsAppTools` — empty in v1 (WhatsApp exposes no user directory, so
  there is no `lookup_user` equivalent). Spread into `tools` for future
  compatibility.
- `defaultWhatsAppContext` — two context entries: WhatsApp formatting rules
  (bold/italic/code, no headings or clickable links) and delivery constraints (no
  streaming, no message editing). Spread into `context`.
- `whatsAppFormattingContext` / `whatsAppDeliveryContext` — the individual entries
  if you need to compose them selectively.

## Tool context

Tools receive the single shared `BotToolContext` from `@copilotkit/channels`
(`{ thread, message?, user?, signal?, platform }`) and reach WhatsApp power through
capability-gated `thread` methods this adapter backs:

- `thread.getMessages()` — the current conversation's message history (from
  `HistoryStore`), each a `ThreadMessage` (`{ user?, text, ts?, isBot? }`).
- `thread.postFile({ bytes, filename, title?, altText? })` — upload and send a
  file (image → `image` payload; other → `document` payload via the media-upload
  API).

Note: `thread.lookupUser(query)` is a no-op on WhatsApp — the Cloud API exposes no
user directory. It always returns `undefined`.

## Running the demo

This package is the **library**. A runnable end-to-end demo wiring everything
against a real WhatsApp number lives in
[`examples/whatsapp`](../../examples/whatsapp).

## What's NOT in v1

- No message editing or streaming (WhatsApp messages are immutable)
- No proactive messaging outside the 24-hour customer-service window — the adapter
  does not implement template-message sending; the bot can only reply within the
  24-hour window opened by an inbound user message
- No user directory (`lookupUser` always returns `undefined`)
- No OAuth / multi-number install (single access token only)
- Durable `ActionStore` and `HistoryStore` are in-memory by default; actions and
  history expire on restart unless you provide durable implementations

## Exports

`whatsapp`, `WhatsAppAdapter`; `WhatsAppAdapterOptions`, `ReplyTarget`,
`WhatsAppMessageRef` (types); `WhatsAppConversationStore`;
`InMemoryHistoryStore`, `HistoryStore`, `StoredMessage` (types);
`renderWhatsAppMessage`, `WhatsAppOutbound` (type); `WA_LIMITS`, `truncateText`,
`clampArray`; `markdownToWhatsApp`; `decodeInteraction`, `conversationKeyOf`;
`createRunRenderer`; `WhatsAppClient`, `DownloadedMedia` (type);
`buildFileContentParts`, `AgentContentPart`, `FileDeliveryConfig` (types);
`defaultWhatsAppTools`; `defaultWhatsAppContext`, `whatsAppFormattingContext`,
`whatsAppDeliveryContext`.
