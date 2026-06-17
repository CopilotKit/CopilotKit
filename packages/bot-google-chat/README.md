# @copilotkit/bot-google-chat

The **Google Chat `PlatformAdapter`** for [`@copilotkit/bot`](../bot). It connects a Google Chat app to any AG-UI agent: ingress via an HTTP webhook (JWT-verified), egress via the Chat REST API (`cardsV2` rendering + edit-in-place streaming), plus slash-command routing and HITL.

You write your UI as JSX once (`@copilotkit/bot-ui`) and drive the bot with `@copilotkit/bot`; this package is the only one that talks to Google Chat.

## Install

```sh
pnpm add @copilotkit/bot-google-chat @copilotkit/bot
```

## Google Cloud setup

1. **Create a Google Chat app.** In the [Google Cloud console](https://console.cloud.google.com/), enable the **Google Chat API** for your project, then open **APIs & Services → Google Chat API → Configuration** and fill in the app details.

2. **Configure the webhook URL.** In the Chat app's **Connection settings**, choose **App URL** and set it to your server's webhook endpoint — for example `https://your-host/webhooks/google-chat`. This is the URL Google Chat will `POST` events to.

3. **Copy the GCP project number.** The **GCP project number** (not the project _id_) appears on the project's Dashboard page. Paste it into `googleChatProjectNumber` — the adapter uses it to verify the `aud` claim of inbound JWT tokens.

4. **Create a service account + JSON key.** In **IAM & Admin → Service Accounts**, create (or reuse) a service account, generate a JSON key, and set `GOOGLE_CHAT_CREDENTIALS` to the key file path or the raw JSON string. The adapter passes these credentials to `google-auth-library` to mint bearer tokens for Chat REST API calls.

5. **Message history + DMs (optional).** To enable `thread.getMessages()` and DM conversation history, configure **domain-wide delegation** on the service account:
   - Grant the service account domain-wide delegation authority in your Google Workspace Admin console.
   - Pass an admin user's email as `impersonateUser`.
   - The adapter will request the following OAuth scopes:
     - `https://www.googleapis.com/auth/chat.bot`
     - `https://www.googleapis.com/auth/chat.spaces`
     - `https://www.googleapis.com/auth/chat.messages`
     - `https://www.googleapis.com/auth/chat.spaces.readonly`
     - `https://www.googleapis.com/auth/chat.messages.readonly`

   Without `impersonateUser`, only the `chat.bot` scope is used and message history is unavailable.

## Required env vars

| Var                              | Purpose                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GOOGLE_CHAT_CREDENTIALS`        | Service account JSON key — object literal, path to key file, or raw JSON string. The adapter resolves it automatically. Falls back to `GOOGLE_APPLICATION_CREDENTIALS` (ADC). |
| `GOOGLE_CHAT_PROJECT_NUMBER`     | GCP project number — expected `aud` of inbound webhook JWTs. Pass as `googleChatProjectNumber`. |

## Quickstart

```ts
import { createBot } from "@copilotkit/bot";
import { googleChat, defaultGoogleChatTools, defaultGoogleChatContext } from "@copilotkit/bot-google-chat";
import { HttpAgent } from "@ag-ui/client";

const bot = createBot({
  adapters: [googleChat({
    credentials: process.env.GOOGLE_CHAT_CREDENTIALS,
    googleChatProjectNumber: process.env.GOOGLE_CHAT_PROJECT_NUMBER,
    port: 3000,
  })],
  agent: (threadId) => { const a = new HttpAgent({ url: process.env.AGENT_URL! }); a.threadId = threadId; return a; },
  tools: [...defaultGoogleChatTools],
  context: [...defaultGoogleChatContext],
});
await bot.start();
```

`googleChat(opts)` returns a `GoogleChatAdapter`. When `port` is provided, a self-hosted HTTP server listens on that port. If you already have a server, omit `port` and mount `adapter.requestHandler` yourself (see below).

The adapter pre-filters ingress so that only MESSAGE events (from non-bot senders), slash commands, and ADDED_TO_SPACE events reach the engine; CARD_CLICKED events are routed to the interaction decoder instead.

### Built-in tools and context

- **`defaultGoogleChatTools`** — ships `lookup_google_chat_user` so the agent can resolve a name/handle/email to a `<users/ID>` mention. Spread into `tools`.
- **`defaultGoogleChatContext`** — tagging procedure, Chat Markdown/formatting guidance, and the space/thread conversation model. Spread into `context`.

Both are opt-in: spread them into your `createBot` config or cherry-pick the individual exports (`lookupGoogleChatUserTool`, `googleChatTaggingContext`, `googleChatFormattingContext`, `googleChatConversationModelContext`).

## Capabilities and limitations

| Feature               | Status                                                                            |
| --------------------- | --------------------------------------------------------------------------------- |
| Text streaming        | Edit-in-place (post placeholder → `PATCH`). No native streaming API on Chat.     |
| Typing indicators     | Not supported (`supportsTyping: false`).                                          |
| Reactions             | Not supported (`supportsReactions: false`).                                       |
| Suggested prompts     | Not supported (`supportsSuggestedPrompts: false`).                                |
| Thread titles         | Not supported (`supportsThreadTitle: false`).                                     |
| Message history       | Requires `impersonateUser` (domain-wide delegation); unavailable without it.      |
| DM conversation history | Requires `impersonateUser`; without it each DM turn is stateless.              |
| Slash commands        | Forwarded to `bot.onCommand` handlers; must also be declared in the Chat app console. |
| Cards V2 / buttons    | Full support via `renderCardsV2` / `renderGoogleChatMessage`.                     |
| HITL interactions     | `CARD_CLICKED` events decoded by `decodeInteraction` and dispatched to the engine. |
| File upload           | Best-effort via `thread.postFile` (Chat media upload).                            |

## Slash commands

The adapter forwards every slash command delivered by Google Chat to the engine's `onCommand` routing. Register handlers with `bot.onCommand`:

```ts
bot.onCommand({
  name: "triage",
  description: "Summarize the thread and propose issues.",
  async handler({ thread, text }) {
    await thread.runAgent({ prompt: `Triage: ${text}` });
  },
});
```

**You must also declare each command in the Chat app console** (Google Chat API → Configuration → Slash commands). Google Chat won't deliver an undeclared command. Args arrive as free text (`ctx.text`); the `options` schema is unused on Google Chat.

## Mounting on an existing server

If you already have an Express, Hono, or plain `node:http` server, omit `port` from the adapter options and mount the adapter's `requestHandler` directly:

```ts
import express from "express";
import { googleChat } from "@copilotkit/bot-google-chat";

const adapter = googleChat({
  credentials: process.env.GOOGLE_CHAT_CREDENTIALS,
  googleChatProjectNumber: process.env.GOOGLE_CHAT_PROJECT_NUMBER,
  // no port — we mount it ourselves
});

const app = express();
app.use(express.json());
app.post("/webhooks/google-chat", async (req, res) => {
  const out = await adapter.requestHandler({
    headers: req.headers as Record<string, string>,
    body: req.body,
  });
  res.status(out.status).json(out.body ?? {});
});

// Then wire up the bot:
import { createBot } from "@copilotkit/bot";
const bot = createBot({ adapters: [adapter], agent, tools, context });
await bot.start(); // does NOT start an HTTP server (no port set)
app.listen(3000);
```

`adapter.requestHandler` is a public `ChatRequestHandler` — it verifies the JWT, routes the event, and returns `{ status, body }`. Failed JWT verification returns `{ status: 401 }`.

## Pub/Sub (future)

The v1 transport is **direct HTTP webhook** — Google Chat POSTs events to your `App URL` and expects a synchronous `200` response containing any immediate reply card. This is the simplest deployment model and covers all current use cases.

A Pub/Sub transport (where Chat publishes events to a Cloud Pub/Sub topic and the bot pulls/subscribes asynchronously) is a documented future extension. It would enable longer-running agent turns without the need to reply synchronously, and is particularly relevant for multi-region or serverless deployments. No code changes to the adapter core would be required — only a new ingress shim that pulls from Pub/Sub and calls `adapter.requestHandler`. This is out of scope for v1.

## What's NOT in v1

- Modals / batched form submit
- OAuth multi-workspace install (single service account only)
- Durable (Redis/DB) `ActionStore` — in-memory only; interactions expire on restart
- Proactive posting (bot replies only to turns it participates in)
- Reactions
- Native streaming (edit-in-place used instead)
- Suggested prompts / assistant pane (Google Chat has no equivalent)

## Exports

`googleChat`, `GoogleChatAdapter`, `GoogleChatAdapterOptions`; `createRequestHandler`, `startServer`, `ChatRequestHandler`; `createTokenProvider`, `createInboundVerifier`, `UnauthorizedError`, `TokenProvider`, `InboundVerifier`; `routeChatEvent`; `decodeInteraction`; `createRunRenderer`; `renderCardsV2`, `renderGoogleChatMessage`, `GCHAT_LIMITS`; `markdownToChat`; `MessageStream`, `MessageStreamConfig`, `TextStream`; `ChunkedMessageStream`, `ChunkedMessageStreamConfig`; `GoogleChatConversationStore`, `AgentSession`, `ChatClient`, `ChatMessage`; `conversationKeyOf`, `DM_SCOPE`; `ConversationKey`, `IncomingTurn`, `ReplyTarget`; `defaultGoogleChatTools`, `lookupGoogleChatUserTool`, `defaultGoogleChatContext`, `googleChatTaggingContext`, `googleChatFormattingContext`, `googleChatConversationModelContext`.
