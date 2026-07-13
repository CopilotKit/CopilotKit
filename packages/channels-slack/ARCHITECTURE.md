# Architecture

How `@copilotkit/channels-slack` is structured and **why** each boundary exists.

Application authors use this package with the product-facing
[`@copilotkit/channels`](../channels) umbrella. `SlackAdapter` imports and
implements [`PlatformAdapter`](../channels-core) from
[`@copilotkit/channels-core`](../channels-core). The channel engine owns the
platform-agnostic orchestration (handlers, the
run/tool/interrupt loop, JSX action binding, the `ActionStore`); this package
owns everything Slack-specific: Bolt ingress, Block Kit egress, streaming,
and opaque-id interactions.

## Design goals

1. **The agent doesn't know about Slack.** It receives ordinary AG-UI input
   and emits ordinary AG-UI events.
2. **Slack mechanics don't bleed into the engine.** `chat.update` throttling,
   mrkdwn translation, chunking, interrupt capture, and `block_actions`
   routing all live behind the `PlatformAdapter` interface.
3. **One file, one job.** Each source file has a single responsibility.
4. **Failures are contained.** A failed `chat.update` doesn't crash the run.
5. **No durable Slack-side state.** Slack is the source of truth
   (`conversations.replies` / `conversations.history`); the conversation
   store reconstructs each turn's `agent.messages` from Slack on the fly.

## The boundary: `PlatformAdapter`

`SlackAdapter` (constructed via `slack(opts)`) implements
[`PlatformAdapter`](../channels-core) from
[`@copilotkit/channels-core`](../channels-core). The members it implements:

```
SlackAdapter (`@copilotkit/channels-slack`)
  └── imports / implements ──► `@copilotkit/channels-core`: `PlatformAdapter`

`@copilotkit/channels` is the product-facing umbrella, not an adapter dependency.
```

- `platform`, `capabilities` (`supportsStreaming: true`, modals/typing/
  reactions `false`, `maxBlocksPerMessage: 50`; `supportsSuggestedPrompts` /
  `supportsThreadTitle` computed from whether the assistant pane is enabled),
  `ackDeadlineMs` (3000)
- `start(sink)` / `stop()` — bring the Bolt app up / down and push normalized
  events into the engine's `IngressSink` (`onTurn` / `onInteraction` /
  `onCommand` / `onThreadStarted`)
- `setSuggestedPrompts` / `setThreadTitle` — back the capability-gated
  `thread.setSuggestedPrompts` / `thread.setTitle` via `assistant.threads.*`
- `render(ir)` — IR → Block Kit (`renderBlockKit`)
- `post` / `update` / `stream` / `delete` — egress via the Slack Web client
- `createRunRenderer(target)` — the AG-UI `RunRenderer` for a run
- `decodeInteraction(raw)` — native `block_actions` payload → `InteractionEvent`
- `lookupUser(query)` — directory search for `@`-mention resolution
  (backs `thread.lookupUser`)
- `getMessages(target)` — the thread's messages via `conversations.replies`
  (backs `thread.getMessages`)
- `postFile(target, args)` — upload a file via `files.uploadV2`
  (backs `thread.postFile`)
- `conversationStore` — Slack-backed `getOrCreate` → `AgentSession`

The engine drives ingress through the `IngressSink` it hands to `start`
(`sink.onTurn` / `sink.onInteraction`) and egress through these methods.

## Request lifecycle

```
Slack event ──► attachSlackListener ──► IngressSink.onTurn(IncomingTurn)
                                                    │
                                                    ▼
                                     @copilotkit/channels-core: Thread
                                                    │  thread.runAgent()
                                                    ▼
                                          runAgentLoop
            ┌──────────────────────────────────────┴──────────────────────────────┐
            │ agent.runAgent(..., RunRenderer.subscriber)                           │
            │   • event-renderer streams TEXT_MESSAGE_* → chat.update (Block Kit)   │
            │   • captures frontend tool calls + on_interrupt custom events         │
            └──────────────────────────────────────┬──────────────────────────────┘
                                                    │
                  ┌─────────────────────────────────┼─────────────────────────────┐
                  ▼ (captured tool call)            ▼ (captured interrupt)         ▼ (done)
        tool.handler(args, ctx)            onInterrupt handler                  finish
        renders JSX via thread.post        posts picker via thread.post
        → renderSlackMessage/renderBlockKit  → awaitChoice / thread.resume(value)
        → Block Kit posted to Slack          re-enters runAgentLoop with
                                             forwardedProps.command on resume
```

### Ingress

`attachSlackListener` is the translation layer between Slack's event model
and the engine's domain. It filters subtypes, bot echoes, untracked threads,
and mention duplicates, and emits a normalized turn. The adapter resolves the
sender to a `PlatformUser` (cached per id) and calls `sink.onTurn` with a
`conversationKey` (`conversationKeyOf`), `replyTarget`, `userText`, and
`user`.

### Run / render

`thread.runAgent` resolves the conversation's `AgentSession` from the
`conversationStore`, creates `createRunRenderer(target)`, and runs
`runAgentLoop`. The renderer (`event-renderer.ts`) subscribes to AG-UI
events: it lazily creates a stream on the first `TEXT_MESSAGE_CONTENT`,
accumulates deltas, optionally surfaces `:wrench:` / `:white_check_mark:`
tool-status rows (`showToolStatus`), and captures frontend tool calls and
`on_interrupt` custom events for the loop to read after each `runAgent`.

### Tools

When the agent calls a registered frontend tool, the loop validates the args
(Standard Schema) and invokes `tool.handler(args, ctx)`. `ctx` is the single
shared `ChannelToolContext` (`{ thread, message?, user?, signal?, platform }`) —
there is no Slack-specific context. Slack power is reached only through
capability-gated `thread` methods the adapter backs (`getMessages`,
`lookupUser`, `postFile`). A render-tool handler renders JSX with
`thread.post(<Card .../>)`, which goes through the engine's action-binding
then `renderSlackMessage` / `renderBlockKit` → Block Kit.

### HITL & interrupts

`thread.awaitChoice(<Picker .../>)` posts a picker and blocks the engine's
waiter until a click in that conversation resolves it. A captured agent
interrupt is dispatched to the registered `onInterrupt` handler, which posts a
picker whose button `onClick` calls `thread.resume(value)`; the loop
re-enters with `forwardedProps.command`.

### Interactions

`app.action(/.*/)` acks every click within ≤3s, then `decodeInteraction`
pulls the opaque minted id (`ck:…`), any tiny `bind()` value, and the message
ref out of the `block_actions` payload, building an `InteractionEvent`. The
engine resolves it: an awaiting HITL waiter, or `ActionRegistry.dispatch` —
a hot-cache hit, or a **cold-path re-render rehydration** (load the snapshot,
re-render the named component with frozen props, re-walk to the handler's
path). A miss after restart degrades to "this action expired."

## Agent-native Slack APIs (assistant pane + native streaming)

Two agent-grade Slack API families are wired in, **on by default**, each
degrading safely:

- **Native streaming** (`native-stream.ts`). `NativeMessageStream` implements
  the same `append(fullText)/finish()` contract as `MessageStream`, so the
  event-renderer's text stream and `adapter.stream()` are transport-agnostic.
  It drives `chat.startStream` / `appendStream` (raw `markdown_text`, no mrkdwn
  translation) / `stopStream`, with a ~600ms throttle (under `appendStream`'s
  Tier-4 limit). A whole turn streams into **one** message — text accumulates
  there (chunked at the 12k per-append cap, no multi-message splitting), and
  `appendChunk()` interleaves structured {@link AnyChunk}s (`task_update` for
  tool progress) after flushing pending text so ordering holds. `finish(blocks)`
  finalizes the message, optionally with a trailing Block Kit row (feedback).
  The event-renderer keeps the stream **turn-scoped** across `runAgent`
  iterations and closes it via the engine's `RunRenderer.finish()` hook. Used
  wherever a `threadTs` exists; flat DMs and a failed first `startStream` fall
  back to the legacy `chat.update` transport (the workspace is marked legacy
  in-memory so later streams skip the native path), and a failed structured
  chunk degrades tool progress to `:wrench:` rows. `streaming: "legacy"` forces
  the old transport.
- **Feedback row** (opt-in via `feedback`). Streamed replies finalize with a
  native `feedback_buttons` row (`context_actions`, built in `render/block-kit.ts`)
  attached at `stopStream`; the adapter intercepts those clicks in
  `app.action` (by `FEEDBACK_ACTION_ID`) and routes them to `onFeedback`,
  bypassing the engine's interaction dispatch.
- **Assistant pane** (`assistant.ts`). `attachAssistant` registers Bolt's
  `Assistant` middleware and is the SOLE owner of pane events. On
  `assistant_thread_started` it applies static defaults (greeting + suggested
  prompts) then emits `sink.onThreadStarted` (engine handlers layer on top,
  never race); a pane user message becomes exactly one `sink.onTurn` scoped to
  the pane thread (`channelId::threadTs`), auto-titled from the first message.
  Pane threads are tracked in-memory so `slack-listener.ts`'s one-line guard
  skips the threaded `message.im` events the Assistant middleware already owns —
  exactly one turn per pane message, with ordinary threaded DMs untouched. In a
  pane thread the run lifecycle drives native composer status
  (`assistant.threads.setStatus`) instead of placeholder / `:wrench:` messages.

Status is **not** a `Thread` method — it stays renderer-managed from the
run/tool lifecycle; only prompts and titles (which only the author knows) get
`Thread` methods.

## Preserved mechanics

These files carry over from the pre-rework package, lightly adapted:

| File                        | Job                                                                     |
| --------------------------- | ----------------------------------------------------------------------- |
| `slack-listener.ts`         | Slack events → normalized turns; ingress filters.                       |
| `conversation-store.ts`     | Slack-backed history reconstruction; folds chunked bot replies.         |
| `message-stream.ts`         | Per-message `chat.update` queue + ≥800ms throttle (no update races).    |
| `chunked-message-stream.ts` | Multi-message chunking; keeps fenced blocks whole; per-chunk transform. |
| `auto-close-streaming.ts`   | Closes dangling markdown brackets mid-stream (idempotent).              |
| `markdown-to-mrkdwn.ts`     | GFM Markdown → Slack mrkdwn; column-aligns tables in a fence.           |
| `download-files.ts`         | Inbound file download → AG-UI multimodal content parts.                 |
| `sanitizing-http-agent.ts`  | HTTP agent that sanitizes outbound requests to the AG-UI backend.       |

## SDK files at a glance

```
src/
├── index.ts                  # public exports
├── adapter.ts                # slack() factory + SlackAdapter (PlatformAdapter impl) + Bolt wiring
├── assistant.ts              # attachAssistant: Bolt Assistant middleware ⇄ engine sink (pane events)
├── native-stream.ts          # NativeMessageStream: chat.startStream/appendStream/stopStream (+ legacy fallback)
├── event-renderer.ts         # createRunRenderer: AG-UI subscriber → stream + tool/interrupt capture + pane status
├── interaction.ts            # decodeInteraction (opaque id) + conversationKeyOf
├── render/
│   ├── block-kit.ts          # renderBlockKit / renderSlackMessage (IR → Block Kit)
│   └── budget.ts             # SLACK_LIMITS + truncate/clamp degradation
├── slack-listener.ts         # Slack events → IncomingTurn (filters)
├── conversation-store.ts     # Slack-backed conversation reconstruction
├── chunked-message-stream.ts # multi-message chunking + mrkdwn transform
├── message-stream.ts         # per-message chat.update queue + throttle
├── markdown-to-mrkdwn.ts     # md → Slack mrkdwn
├── auto-close-streaming.ts   # mid-stream bracket closer
├── download-files.ts         # inbound file → multimodal content parts
├── sanitizing-http-agent.ts  # sanitizing AG-UI HTTP agent
├── built-in-tools.ts         # lookup_slack_user + defaultSlackTools (as ChannelTools)
├── built-in-context.ts       # tagging / mrkdwn / convo-model context entries
└── types.ts                  # IncomingTurn, ReplyTarget, ConversationKey, DM_SCOPE, SlackAssistantOptions
```

## What's intentionally _not_ abstracted

- **No abstraction over Bolt.** If you use this package, you're talking to
  Slack.
- **No durable Slack-side state.** The next turn rebuilds context from Slack
  history; restarts are safe for conversation history by construction.
  (The engine's `ActionStore` is separately in-memory in v1, so inline
  interaction handlers expire on restart — see the
  [`@copilotkit/channels` README](../channels/README.md), the product-facing
  umbrella documentation.)
