# Architecture

How `@copilotkit/channels-whatsapp` is structured and **why** each boundary exists.

This package is the WhatsApp `PlatformAdapter` for [`@copilotkit/channels`](../channels).
The channel engine owns the platform-agnostic orchestration (handlers, the
run/tool/interrupt loop, JSX action binding, the `ActionStore`); this package
owns everything WhatsApp-specific: webhook ingress, Cloud API egress, buffered
rendering, and opaque-id interactions.

## Design goals

1. **The agent doesn't know about WhatsApp.** It receives ordinary AG-UI input
   and emits ordinary AG-UI events.
2. **WhatsApp mechanics don't bleed into the engine.** Webhook signature
   validation, message buffering, history reconstruction, interactive-message
   encoding, and `button_reply` / `list_reply` decoding all live behind the
   `PlatformAdapter` interface.
3. **One file, one job.** Each source file has a single responsibility.
4. **Failures are contained.** A failed send doesn't crash the run.
5. **History is adapter-owned.** WhatsApp exposes no readable message history;
   the adapter maintains a `HistoryStore` and replays it on every turn. This is
   the key difference from Slack: history is held locally, not reconstructed
   from the platform, so a durable `HistoryStore` is required for persistent
   memory across restarts.

## The boundary: `PlatformAdapter`

`WhatsAppAdapter` (constructed via `whatsapp(opts)`) implements
`@copilotkit/channels`'s `PlatformAdapter`. The members it implements:

- `platform`, `capabilities` (`supportsStreaming: false`, modals/typing/
  reactions all `false`), `ackDeadlineMs` (5000)
- `start(sink)` / `stop()` — start / stop the `WebhookServer` and push
  normalized events into the engine's `IngressSink`
- `render(ir)` — IR → Cloud API payloads (`renderWhatsAppMessage`)
- `post` / `update` / `stream` / `delete` — egress via `WhatsAppClient`;
  `update` re-posts (no edit API), `delete` is a no-op, `stream` buffers the
  full iterable then posts once
- `createRunRenderer(target)` — the AG-UI `RunRenderer` for a run; buffers
  the full response and sends as text
- `decodeInteraction(raw)` — inbound `button_reply` / `list_reply` payload →
  `InteractionEvent`
- `lookupUser(query)` — always returns `undefined` (no user directory on
  WhatsApp)
- `getMessages(target)` — the conversation's messages from `HistoryStore`
  (backs `thread.getMessages`)
- `postFile(target, args)` — upload media via the media-upload API then send
  (backs `thread.postFile`)
- `conversationStore` — `WhatsAppConversationStore` backed by `HistoryStore`

The engine drives ingress through the `IngressSink` it hands to `start`
(`sink.onTurn` / `sink.onInteraction`) and egress through these methods.

## Request lifecycle

```
WhatsApp Cloud API
  │
  ▼
WebhookServer
  GET /webhook  ──► verify hub.verify_token → 200 + hub.challenge
  POST /webhook ──► validate X-Hub-Signature-256
                         │
                         ▼
                 handleWebhookValue (webhook-listener.ts)
                   • filters status updates, own echoes
                   • resolves sender contact from webhook contacts[]
                   • dispatches interactive → sink.onInteraction
                                  text/media → sink.onTurn (with HistoryStore.append)
                         │
                         ▼
               @copilotkit/channels: Thread
                         │  thread.runAgent()
                         ▼
                   runAgentLoop
    ┌──────────────────────────────────────────────────────────────────────┐
    │ agent.runAgent(..., RunRenderer.subscriber)                           │
    │   • createRunRenderer buffers TEXT_MESSAGE_* → single send           │
    │   • captures frontend tool calls + on_interrupt custom events        │
    └──────────────────────────────────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────────────────────────┐
          ▼              ▼                                    ▼
  tool.handler(args)  onInterrupt handler                  finish
  renders JSX via     posts interactive message via        HistoryStore.append
  thread.post(...)    thread.post(...) → awaitChoice       (assistant turn)
  → renderWhatsAppMessage → Cloud API                      → thread.resume(value)
```

### Ingress

`handleWebhookValue` is the translation layer between the Cloud API webhook
schema and the engine's domain. It processes each `value` object from
`entry[].changes[]`, skipping status-update entries. For interactive messages
(`button_reply` / `list_reply`) it calls `sink.onInteraction`; for all other
message types (text, image, audio, video, document) it appends the user turn to
`HistoryStore` and calls `sink.onTurn` with a `conversationKey`
(`conversationKeyOf(waId)`), `replyTarget`, `userText`, and `user`.

### Run / render

`thread.runAgent` resolves the conversation's `AgentSession` from the
`conversationStore` (which reads `HistoryStore` to reconstruct `agent.messages`),
creates `createRunRenderer(target)`, and runs `runAgentLoop`. The renderer
(`event-renderer.ts`) subscribes to AG-UI events: it accumulates
`TEXT_MESSAGE_CONTENT` deltas into a full string, then sends it as a single text
message when the run completes. This is the key divergence from Slack: there is no
incremental `chat.update` — the response is buffered and sent once.

### Tools

When the agent calls a registered frontend tool, the loop validates the args
(Standard Schema) and invokes `tool.handler(args, ctx)`. `ctx` is the single
shared `ChannelToolContext` (`{ thread, message?, user?, signal?, platform }`) — there
is no WhatsApp-specific context. WhatsApp power is reached only through
capability-gated `thread` methods (`getMessages`, `postFile`). A render-tool
handler renders JSX with `thread.post(<Card .../>)`, which goes through the
engine's action-binding then `renderWhatsAppMessage` → Cloud API.

### HITL and interrupts

`thread.awaitChoice(<Picker .../>)` posts an interactive message and blocks until
a `button_reply` or `list_reply` in that conversation resolves it. A captured
agent interrupt is dispatched to the registered `onInterrupt` handler, which posts
a picker whose button `onClick` calls `thread.resume(value)`; the loop re-enters
with `forwardedProps.command`.

### Interactions

`handleWebhookValue` routes every `button_reply` / `list_reply` directly to
`sink.onInteraction`. `decodeInteraction` splits the reply id: bare minted ids
(`ck:...`) are dispatched directly; ids encoded as `${actionId}::${JSON.stringify(value)}`
are split back into `id` + `value`. The engine resolves the interaction: an
awaiting HITL waiter, or `ActionRegistry.dispatch` — a hot-cache hit or a
cold-path re-render rehydration. A miss after restart degrades to "this action
expired." Because there is no ack deadline in the webhook model (no 3-second
constraint like Slack), the `ackDeadlineMs` is set to 5000ms to give the
engine time to dispatch before the webhook response times out.

## What differs from Slack

| Concern             | Slack                                               | WhatsApp                                                                |
| ------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Ingress             | Socket Mode (outbound WebSocket via Bolt)           | HTTP webhook (signed POST); needs a public URL                          |
| Egress              | `chat.update` streaming; message editing            | Buffered single send; no message editing or delete                      |
| History             | Reconstructed from `conversations.replies` per turn | Held in `HistoryStore`; durable storage is required for persistence     |
| Commands            | Native slash commands via Slack app config          | Leading-keyword text match; not a native surface                        |
| Command persistence | Slash commands appear in the thread history         | Commands are NOT persisted at ingress (engine prompt path injects them) |
| User directory      | `lookupUser` resolves names/emails to `<@USERID>`   | `lookupUser` always returns `undefined`                                 |
| Streaming           | `chat.update` throttle; live editing                | Not supported; buffer + single send                                     |

## SDK files at a glance

```
src/
├── index.ts                  # public exports
├── adapter.ts                # whatsapp() factory + WhatsAppAdapter (PlatformAdapter impl)
├── event-renderer.ts         # createRunRenderer: AG-UI subscriber → buffered send + interrupt capture
├── interaction.ts            # decodeInteraction (opaque id) + conversationKeyOf
├── render/
│   ├── message.ts            # renderWhatsAppMessage (IR → Cloud API payloads)
│   └── budget.ts             # WA_LIMITS + truncateText / clampArray degradation
├── webhook-server.ts         # HTTP server: GET verify + signed POST dispatch
├── webhook-listener.ts       # handleWebhookValue: Cloud API webhook → onTurn / onInteraction
├── client.ts                 # WhatsAppClient: send messages, upload media, download media
├── conversation-store.ts     # WhatsAppConversationStore: HistoryStore → AgentSession
├── history-store.ts          # HistoryStore interface + InMemoryHistoryStore
├── markdown-to-wa.ts         # GFM Markdown → WhatsApp formatting (bold/italic/code/strikethrough)
├── download-files.ts         # inbound media download → AG-UI multimodal content parts
├── built-in-tools.ts         # defaultWhatsAppTools (empty in v1; no user directory)
├── built-in-context.ts       # formatting + delivery context entries
└── types.ts                  # WhatsAppAdapterOptions, ReplyTarget, WhatsAppMessageRef, InboundMessage, …
```

## What's intentionally _not_ abstracted

- **No abstraction over the Cloud API.** If you use this package, you're talking
  to Meta's WhatsApp Cloud API.
- **No template-message sending.** The adapter only replies within the 24-hour
  customer-service window opened by an inbound user message. Proactive messaging
  requires template approval and is not implemented in v1.
- **History is not platform-sourced.** Unlike Slack, there is no API to read
  WhatsApp message history. The adapter's `HistoryStore` is the source of truth;
  restarts lose history unless a durable `HistoryStore` is provided.
