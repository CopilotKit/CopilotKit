# Architecture

How `@copilotkit/bot-google-chat` is structured and **why** each boundary exists.

This package is the Google Chat `PlatformAdapter` for [`@copilotkit/bot`](../bot). The bot engine owns the platform-agnostic orchestration (handlers, the run/tool/interrupt loop, JSX action binding, the `ActionStore`); this package owns everything Google Chat-specific: HTTP webhook ingress, JWT verification, Chat REST API egress, edit-in-place streaming, and `CARD_CLICKED` interaction decoding.

## Design goals

1. **The agent doesn't know about Google Chat.** It receives ordinary AG-UI input and emits ordinary AG-UI events.
2. **Google Chat mechanics don't bleed into the engine.** JWT verification, edit-in-place throttle chunking, `cardsV2` rendering, slash-command routing, and `CARD_CLICKED` decoding all live behind the `PlatformAdapter` interface.
3. **One file, one job.** Each source file has a single responsibility.
4. **Failures are contained.** A failed `patchMessage` during streaming doesn't crash the run.
5. **No durable Chat-side state.** The Chat REST API (`listMessages`) is the source of truth; the conversation store reconstructs each turn's message history from the API on the fly. Restarts are safe for conversation history by construction.

## The boundary: `PlatformAdapter`

`GoogleChatAdapter` (constructed via `googleChat(opts)`) implements `@copilotkit/bot`'s `PlatformAdapter`. The members it implements:

- `platform` (`"google-chat"`), `capabilities` (`supportsStreaming: true`, modals/typing/reactions `false`, `maxBlocksPerMessage: 100`; `supportsSuggestedPrompts` / `supportsThreadTitle` both `false`), `ackDeadlineMs` (30000)
- `start(sink)` / `stop()` — wire up `requestHandler` with the live event router and optionally start the self-hosted HTTP server; push normalized events into the engine's `IngressSink` (`onTurn` / `onInteraction` / `onCommand` / `onThreadStarted`)
- `render(ir)` — IR → `{ cardsV2 }` or `{ text }` via `renderCardsV2`
- `post` / `update` / `stream` / `delete` — egress via `ChatClient` (`createMessage` / `patchMessage` / `deleteMessage`)
- `createRunRenderer(target)` — the AG-UI `RunRenderer` for a run
- `decodeInteraction(raw)` — `CARD_CLICKED` payload → `InteractionEvent`
- `lookupUser(_q)` — returns `undefined` in v1 (no reliable directory API without domain delegation)
- `getMessages(target)` — space messages via `ChatClient.listMessages` (backs `thread.getMessages`)
- `postFile(target, args)` — best-effort attachment upload via `ChatClient.uploadAttachment`
- `conversationStore` — Chat-backed `getOrCreate` → `AgentSession`
- `requestHandler` — public `ChatRequestHandler` mountable on any Node/Express/Hono server
- `registerCommands(_commands)` — no-op + log (Chat slash commands are configured in the console, not via API)

The engine drives ingress through the `IngressSink` it hands to `start` and egress through these methods.

## Request lifecycle

```
POST /webhooks/google-chat
        │
        ▼
 createRequestHandler
  ── verify JWT (auth.ts) ──► 401 on failure
        │
        ▼
  decodeInteraction?
  ├─ CARD_CLICKED ──────────────────────────► sink.onInteraction(InteractionEvent)
  └─ other ──► routeChatEvent (listener.ts)
                 ├─ MESSAGE + slashCommand ──► sink.onCommand
                 ├─ MESSAGE (user turn) ──────► sink.onTurn(IncomingTurn)
                 ├─ BOT sender → skip (loop guard)
                 └─ ADDED_TO_SPACE ──────────► sink.onThreadStarted
                          │
                          ▼
              @copilotkit/bot: Thread
                          │  thread.runAgent()
                          ▼
                  runAgentLoop
     ┌─────────────────────────────────────────────────────────┐
     │ agent.runAgent(..., RunRenderer.subscriber)              │
     │   • TEXT_MESSAGE_* → ChunkedMessageStream               │
     │     (post placeholder → patchMessage, edit-in-place)    │
     │   • TOOL_CALL_START/END → tool-status rows              │
     │   • onCustomEvent (on_interrupt) → pendingInterrupt     │
     └─────────────────────────────────────────────────────────┘
              │                   │                  │
        (tool call)          (interrupt)           (done)
     tool.handler(args,ctx)  onInterrupt handler    finish
     renders JSX via         posts picker via
     thread.post(...)        thread.post(...)
     → renderCardsV2         → awaitChoice /
     → ChatClient.           thread.resume(value)
       createMessage
```

### Ingress

`routeChatEvent` (`listener.ts`) is the translation layer between the raw Google Chat webhook event and the engine's domain. It filters bot echoes (loop guard: `sender.type === "BOT"` or `sender.name === botUserId`), extracts the thread scope and `ReplyTarget`, and dispatches to the appropriate `IngressSink` callback. `decodeInteraction` (`interaction.ts`) handles `CARD_CLICKED` before `routeChatEvent` sees it, pulling the opaque `invokedFunction` id, any `value` parameter, and the message ref.

### JWT verification

`createInboundVerifier` (`auth.ts`) verifies the `Authorization: Bearer <jwt>` header on every inbound POST. Chat webhook JWTs are signed by the Chat system service account (`chat@system.gserviceaccount.com`), not Google's standard federated OIDC keys, so it uses `google-auth-library`'s `OAuth2Client.verifySignedJwtWithCertsAsync(token, certs, audience, [CHAT_ISSUER])` rather than `verifyIdToken` (which can't be pointed at custom certs). It fetches that account's x509 certs from the cert endpoint and verifies the signature, the `aud` (matching `googleChatProjectNumber` or an explicit `audience`), and the `iss` (the Chat issuer) against them in one call. Because Google rotates these signing keys frequently, the in-memory cert cache self-heals: on a verification failure it refetches the certs once and retries before rejecting the token. Returns 401 immediately if verification still fails.

### Egress / streaming

`ChatClient` (`chat-client.ts`) is a thin fetch wrapper over the Chat REST v1 API. It mints a bearer token from the service account credentials on each call (via `createTokenProvider`) and makes `createMessage` / `patchMessage` / `deleteMessage` / `listMessages` / `uploadAttachment` requests.

Streaming is **edit-in-place**: the agent's text deltas accumulate in `ChunkedMessageStream`, which posts a `_thinking…_` placeholder on the first content, then throttles `patchMessage` calls (≥1s between edits, serialized per message to prevent race conditions). Long replies are split across multiple Chat messages at stable line/word boundaries, keeping fenced code blocks whole.

### Tools

When the agent calls a registered frontend tool, the loop validates args (Standard Schema) and invokes `tool.handler(args, ctx)`. `ctx` is the shared `BotToolContext` (`{ thread, message?, user?, signal?, platform }`) — there is no Google Chat-specific context. Chat power is reached only through capability-gated `thread` methods the adapter backs (`getMessages`, `postFile`).

### HITL and interrupts

`thread.awaitChoice(<Picker .../>)` posts an interactive card and blocks until a `CARD_CLICKED` event resolves it. A captured agent interrupt (AG-UI `onCustomEvent` with name matching `interruptEventNames`) is dispatched to the registered `onInterrupt` handler, which posts a picker whose button `onClick` calls `thread.resume(value)`; the loop re-enters with `forwardedProps.command`.

### Interactions

Every `CARD_CLICKED` event is routed through `decodeInteraction` (before `routeChatEvent`). It extracts the `invokedFunction` field (or `actionMethodName`), the `value` parameter, the conversation key, and the message ref. The engine resolves it: an awaiting HITL waiter, or `ActionRegistry.dispatch` — a hot-cache hit, or cold-path re-render rehydration. A miss after restart degrades to "this action expired."

## Per-file responsibilities

| File                        | Job                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `adapter.ts`                | `googleChat()` factory + `GoogleChatAdapter` (full `PlatformAdapter` impl); wires all collaborators. |
| `auth.ts`                   | `createTokenProvider` (service-account bearer tokens via `google-auth-library`) + `createInboundVerifier` (JWT check against Chat x509 certs) + `UnauthorizedError`. |
| `chat-client.ts`            | `ChatClient`: thin fetch wrapper over Chat REST v1 — `createMessage`, `patchMessage`, `deleteMessage`, `listMessages`, `uploadAttachment`. |
| `server.ts`                 | `createRequestHandler` (JSON-parse + JWT verify + onEvent dispatch → `{ status, body }`) + `startServer` (plain `node:http` listener). |
| `listener.ts`               | `routeChatEvent`: raw Chat webhook event → `onTurn` / `onCommand` / `onThreadStarted`; loop-guard filters; thread-scope resolution. |
| `interaction.ts`            | `decodeInteraction`: `CARD_CLICKED` payload → `InteractionEvent` (extracts opaque id, value param, message ref). |
| `conversation-store.ts`     | `GoogleChatConversationStore`: `listMessages` → translated `AgentMessage[]` history; `getOrCreate` builds each `AgentSession`. |
| `event-renderer.ts`         | `createRunRenderer`: AG-UI subscriber → `ChunkedMessageStream` (text), tool-status rows, interrupt capture, abort/mark-interrupted. |
| `message-stream.ts`         | `MessageStream`: per-message `patchMessage` queue + ≥1s throttle (no update races). |
| `chunked-message-stream.ts` | `ChunkedMessageStream`: multi-message chunking; freezes boundaries at newlines/spaces; keeps fenced code blocks whole; per-chunk `MessageStream`. |
| `markdown.ts`               | `markdownToChat`: GFM Markdown → Google Chat text format (`**bold** → *bold*`, `*italic* → _italic_`, links, bullets, table-in-fence). |
| `render/cards-v2.ts`        | `renderGoogleChatMessage` / `renderCardsV2`: IR → `{ cardsV2 }` or `{ text }` (plain-text IR shortcut). Button `onClick.action.function` carries the opaque `ck:` id from the action registry. |
| `render/budget.ts`          | `GCHAT_LIMITS` (per-element caps) + `truncateText` / `clampArray` degradation helpers. |
| `built-in-tools.ts`         | `lookupGoogleChatUserTool` (`lookup_google_chat_user`) + `defaultGoogleChatTools`. |
| `built-in-context.ts`       | `googleChatTaggingContext`, `googleChatFormattingContext`, `googleChatConversationModelContext` + `defaultGoogleChatContext`. |
| `types.ts`                  | `ReplyTarget`, `ConversationKey`, `IncomingTurn`, `GoogleChatAdapterOptions`, `DM_SCOPE`, `conversationKeyOf`. |

## SDK files at a glance

```
src/
├── index.ts                    # public exports
├── adapter.ts                  # googleChat() factory + GoogleChatAdapter (PlatformAdapter impl)
├── auth.ts                     # JWT inbound verify + service-account token provider
├── chat-client.ts              # Chat REST v1 fetch wrapper (createMessage/patchMessage/…)
├── server.ts                   # createRequestHandler + startServer (node:http)
├── listener.ts                 # routeChatEvent: raw event → IncomingTurn (filters)
├── interaction.ts              # decodeInteraction: CARD_CLICKED → InteractionEvent
├── conversation-store.ts       # Chat-backed history reconstruction → AgentSession
├── event-renderer.ts           # createRunRenderer: AG-UI subscriber → stream + tool/interrupt capture
├── message-stream.ts           # per-message patchMessage queue + throttle
├── chunked-message-stream.ts   # multi-message chunking + fence-aware boundaries
├── markdown.ts                 # markdownToChat: GFM → Chat text format
├── render/
│   ├── cards-v2.ts             # renderGoogleChatMessage / renderCardsV2 (IR → cardsV2)
│   └── budget.ts               # GCHAT_LIMITS + truncate/clamp degradation
├── built-in-tools.ts           # lookup_google_chat_user + defaultGoogleChatTools
├── built-in-context.ts         # tagging / formatting / conversation-model context entries
└── types.ts                    # ReplyTarget, ConversationKey, IncomingTurn, GoogleChatAdapterOptions
```

## What's intentionally _not_ abstracted

- **No wrapper over the Chat REST client.** `ChatClient` is a direct fetch wrapper, not an SDK facade. If you use this package, you're talking to the Google Chat REST API.
- **No durable Chat-side state.** The next turn rebuilds context from `listMessages`; restarts are safe for conversation history by construction. (The engine's `ActionStore` is separately in-memory in v1, so inline interaction handlers expire on restart — see the `@copilotkit/bot` README.)
- **Edit-in-place instead of native streaming.** Google Chat has no streaming API; the adapter simulates streaming by posting a placeholder and throttled-patching it. This is an intentional design choice — the alternative (post full reply at end) gives worse UX, and a future streaming API could be swapped in without changing the engine.
- **No assistant pane.** Google Chat has no equivalent to Slack's assistant pane. `supportsSuggestedPrompts` and `supportsThreadTitle` are both `false`; `setSuggestedPrompts` and `setThreadTitle` are not implemented.
