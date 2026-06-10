# Architecture

How `@copilotkit/slack` is structured and **why** each boundary
exists.

## Design goals

1. **The agent doesn't know about Slack.** It receives ordinary AG-UI
   input and emits ordinary AG-UI events.
2. **Slack-side mechanics don't bleed into agent orchestration.**
   `chat.update` throttling, mrkdwn translation, chunking, interrupt
   capture, and `block_actions` routing all live behind tight APIs.
3. **One file, one job.** A first-time reader should be able to open
   any source file and understand its responsibility without reading
   the rest.
4. **Failures are contained.** A failed `chat.update` doesn't crash the
   run; a failed agent run still posts a user-visible warning.
5. **No durable state in the bridge.** Slack is the source of truth
   (`conversations.replies` / `conversations.history`); the bridge
   reconstructs every turn's `agent.messages` from Slack on the fly.

## App / SDK split

The SDK is the published library; the runnable demo app lives in the
`examples/slack` package.

```
packages/slack/
└── src/                              # SDK — agent- and bot-agnostic

examples/slack/                       # runnable demo (slack-example)
├── app/                              # User-land — this particular Slack bot
│   ├── index.ts                      # bootstrap (env → createSlackBridge)
│   ├── tools/                        # app-specific frontend tools
│   ├── context/                      # app-specific knowledge entries
│   ├── components/                   # app-specific render-only components
│   ├── human-in-the-loop/            # app-specific interactive components
│   └── interrupts/                   # app-specific LangGraph interrupt handlers
├── agent/                            # vendored AG-UI agent backend (standalone)
├── e2e/                              # live-Slack test harness
└── runtime.ts                        # standalone CopilotKit Runtime for the bridge
```

The SDK exports `defaultSlackTools` + `defaultSlackContext` so the app
spreads them in explicitly — no auto-merge magic.

## Layers (SDK)

```
                  ┌───────────────────────────────────────────────┐
                  │       bridge.ts                               │  createSlackBridge()
                  │       (orchestrator)                          │  start() / stop()
                  └──┬──────────┬──────────┬─────────────┬────────┘
                     │          │          │             │
                     ▼          ▼          ▼             ▼
            ┌────────────┐ ┌─────────┐ ┌──────────┐ ┌─────────────────────┐
            │ slack-     │ │ Slack-  │ │ Bolt     │ │ turn-runner.ts      │
            │ listener   │ │ Conver- │ │ app.     │ │                     │
            │ .ts        │ │ sation- │ │ action() │ │ runTurn(turn, cli): │
            │            │ │ Store   │ │          │ │  getOrCreate sess.  │
            │ app_mention│ │         │ │ routes   │ │  build renderer     │
            │ message    │ │ Slack-  │ │ block_   │ │  runAgent + loop:   │
            │ /agent     │ │ backed; │ │ actions  │ │   - exec FE tools   │
            │ Filters    │ │ has()   │ │ →        │ │   - dispatch        │
            │ subtypes,  │ │ /get-   │ │ HITL     │ │     interrupts      │
            │ bot echo,  │ │ OrCre-  │ │ registry │ │   - on resume:      │
            │ untracked  │ │ ate     │ │          │ │     forwardedProps  │
            │ threads,   │ │ Folds   │ │          │ │     command         │
            │ mention    │ │ chunked │ │          │ │ Interrupt-on-new-   │
            │ duplicates │ │ bot     │ │          │ │ message: abortRun + │
            │            │ │ replies │ │          │ │ markInterrupted +   │
            │            │ │ into 1  │ │          │ │ cancel HITL waits   │
            │ Emits      │ │ assist- │ │          │ └─────┬───────────────┘
            │ Incoming-  │ │ ant     │ │          │       │ creates AgentSubscriber
            │ Turn       │ │ turn    │ │          │       ▼
            └────────────┘ └─────────┘ └──────────┘ ┌─────────────────────┐
                                                    │  event-renderer.ts  │
                                                    │  ───────────────    │
                                                    │  Text streaming:    │
                                                    │   TEXT_MESSAGE_*    │
                                                    │   accumulates       │
                                                    │   deltas locally,   │
                                                    │   lazy stream       │
                                                    │   creation, on_     │
                                                    │   interrupted       │
                                                    │   suffix on abort.  │
                                                    │  Tool calls:        │
                                                    │   silent by         │
                                                    │   default; status   │
                                                    │   posts opt-in via  │
                                                    │   showToolStatus.   │
                                                    │  Custom events:     │
                                                    │   captures `on_     │
                                                    │   interrupt` for    │
                                                    │   the turn-runner   │
                                                    │   to dispatch.      │
                                                    └─────┬───────────────┘
                                                          │ delegates streaming
                                                          ▼
                                                    ┌─────────────────────┐
                                                    │ chunked-message-    │
                                                    │ stream.ts           │
                                                    │ ───────────────     │
                                                    │ N MessageStreams,   │
                                                    │ frozen boundaries,  │
                                                    │ block-keeps-whole   │
                                                    │ (move boundary      │
                                                    │ before fence open). │
                                                    │ Per-chunk transform │
                                                    │ = autoCloseOpen-    │
                                                    │ Markdown +          │
                                                    │ markdownToMrkdwn.   │
                                                    └─────┬───────────────┘
                                                          ▼
                                                    ┌─────────────────────┐
                                                    │ message-stream.ts   │
                                                    │ ───────────────     │
                                                    │ Per-message promise │
                                                    │ queue. One chat.    │
                                                    │ update in flight at │
                                                    │ a time. Throttle    │
                                                    │ ≥800ms between      │
                                                    │ flushes. finish()   │
                                                    │ guarantees final    │
                                                    │ state lands.        │
                                                    └─────────────────────┘
```

## SDK files at a glance

```
src/
├── index.ts                          # public exports
├── bridge.ts                         # createSlackBridge() factory + Bolt wiring
├── slack-listener.ts                 # Slack events → IncomingTurn (filters)
├── turn-runner.ts                    # one-turn orchestration + frontend-tool loop + interrupt dispatch
├── conversation-store.ts             # Slack-backed conversation reconstruction
├── event-renderer.ts                 # AG-UI subscriber → text stream + interrupt capture
├── chunked-message-stream.ts         # multi-message chunking + mrkdwn transform
├── message-stream.ts                 # per-message chat.update queue + throttle
├── markdown-to-mrkdwn.ts             # md → Slack mrkdwn
├── auto-close-streaming.ts           # mid-stream bracket closer
├── frontend-tools.ts                 # FrontendTool type, Standard Schema → JSON-Schema, arg validation
├── standard-schema.ts                # schema-library-agnostic helpers (validate, toJsonSchema)
├── slack-component.ts                # defineSlackComponent (render-only)
├── human-in-the-loop.ts              # defineHumanInTheLoop, registry, applyRenderResult
├── interrupt.ts                      # defineInterruptHandler, CapturedInterrupt
├── built-in-tools.ts                 # lookup_slack_user + defaultSlackTools
├── built-in-context.ts               # tagging / mrkdwn / convo-model context entries
└── types.ts                          # IncomingTurn, ReplyTarget, ConversationKey
```

## Layer responsibilities

### `bridge.ts`

Builds a Bolt `App`, resolves the bot user id, instantiates the
`SlackConversationStore`, builds the unified tools array (components +
HITL adapters + app tools), wires `app.action(/.*/, …)` to the
`HumanInTheLoopRegistry`, and calls `attachSlackListener`. Exposes
`start()` / `stop()`. That's it.

### `slack-listener.ts`

Translation layer between Slack's event model and the bridge's domain.
Filters subtypes, bot echoes, untracked threads, mention duplicates.
Emits a normalised `IncomingTurn { conversation, replyTarget, userText }`
to `onTurn`.

### `turn-runner.ts`

One-turn orchestration. Per-conversation in-flight map enables the
interrupt-on-new-message flow: a new turn aborts the prior `runAgent`,
appends `_(interrupted)_` to whatever the previous reply had streamed
so far, and cancels any HITL/interrupt waits keyed to that conversation.
The main loop:

1. `agent.runAgent({tools, context}, subscriber)` (or
   `{forwardedProps:{command:{resume}}}` on a resume iteration).
2. Inspect the renderer for a captured `on_interrupt` — if present,
   look up an `InterruptHandler`, render the picker, await the
   registry, render the resolution, then loop with `resume`.
3. Otherwise inspect captured frontend-tool calls — execute each via
   the tool's `handler`, append the assistant + tool result messages,
   and loop.
4. When neither category fires, the turn is done.

### `conversation-store.ts`

Slack is the durable store. `getOrCreate` calls
`conversations.replies` / `conversations.history`, translates the
result into AG-UI messages, folds consecutive bot replies into one
assistant turn (since chunked replies look like N messages on Slack),
strips bot status placeholders, and removes `<@bot>` mention tokens
from user text. `has(key)` consults Slack on demand, with an
in-process participation cache so subsequent thread replies are O(1).

### `event-renderer.ts`

Translates AG-UI events into Slack streaming, plus a few side channels:

- **Text streaming**: lazy stream creation (no placeholder until the
  first `TEXT_MESSAGE_CONTENT`); deltas accumulated locally (AG-UI's
  `textMessageBuffer` lags by one).
- **`markInterrupted()`**: synchronously flips an `aborted` flag,
  appends `_(interrupted)_` to in-flight buffers, finishes streams.
  Suppresses the otherwise-default `:warning: Agent error: aborted`.
- **Tool calls**: silent by default. Opt in per-bot via
  `showToolStatus: true | string[]` to get `:wrench:` →
  `:white_check_mark:` rows. Dedup by `toolCallId` so a resumed tool
  can't double-post.
- **`on_interrupt` capture**: stores the most recent custom event so
  the turn-runner can dispatch to an `InterruptHandler` after the run
  finalizes. Auto-parses JSON-stringified payloads from the LangGraph
  adapter.

### `chunked-message-stream.ts`

Wraps N `MessageStream`s. Soft limit ~3500 chars; freezes a boundary at
the last newline/space; if the boundary would split a fenced block, the
boundary moves _before_ the opener so the block lands whole in the next
message. Per-chunk transform =
`autoCloseOpenMarkdown` + `markdownToMrkdwn` so the in-flight Slack
message always renders as valid mrkdwn.

### `message-stream.ts`

Per-Slack-message promise queue + 800ms throttle. Prevents the
"ALPHA → AL" race (two `chat.update`s in flight) by construction.
`finish()` cancels the throttle, enqueues a final flush, awaits the
queue.

### `markdown-to-mrkdwn.ts` / `auto-close-streaming.ts`

Pure functions. The former translates GFM markdown to Slack mrkdwn,
column-aligning tables in a fence. The latter closes dangling
` ``` ` / `` ` `` / `**` / `__` / `*` / `_` / `~~` mid-stream so the
in-flight buffer is renderable; idempotent when the real close shows up.

### `frontend-tools.ts`

- `FrontendTool<Schema extends ObjectSchema>`: name + description + a
  Standard Schema `parameters` (Zod/Valibot/ArkType/…) + `handler(args,
ctx)`. The schema is converted to JSON Schema (native Standard JSON
  Schema, falling back to `zod-to-json-schema` for Zod v3; `$ref`s
  inlined) before being forwarded to the agent via `runAgent({tools})`.
- `parseToolArgs(schema, raw)`: async Standard Schema validation with
  pretty errors. The turn-runner awaits it so `handler` only ever sees
  validated args; validation failures return a clean JSON error to the
  agent.

### `slack-component.ts`

`defineSlackComponent({name, description, props, fallbackText?, render})`.
`render(props) → KnownBlock[]`. Compiles to a `FrontendTool` whose
`handler` calls `chat.postMessage({blocks})`. Render-only — no
interaction.

### `human-in-the-loop.ts`

`defineHumanInTheLoop({name, description, props, fallbackText?, render,
timeoutMs?})`. The `render(state, api)` function is invoked twice (or
more): once with `status: "pending"` (returns the picker blocks),
again with `"resolved" | "cancelled" | "timeout"`. The render result
(`KnownBlock[] | "delete" | "noop"`) is applied via Slack's
`response_url` (`replace_original` / `delete_original`) when a click
delivered one, falling back to `chat.update` / `chat.delete`. Resume
values are minted at render time via `api.respond(value)` — the bridge
mints the `action_id`, stores `(action_id → value)`, and resolves the
wait with that value on click.

`HumanInTheLoopRegistry`: process-local. `Map<action_id, PendingWait>`

- secondary index by `conversationKey` so interrupt-on-new-message can
  cancel everything tied to the aborted run.

### `interrupt.ts`

`defineInterruptHandler({eventName?, name, description, payload,
fallbackText?, render})`. The Slack equivalent of React's
`useInterrupt`. Same `render(state, api)` lifecycle as
`HumanInTheLoop`; same `api.respond(value)`; same registry. The
captured `value` is what `runAgent({forwardedProps: {command:
{resume: value, interruptEvent}}})` passes back to the agent — that
value becomes the return of the LangGraph `interrupt()` call.

## Why these boundaries

**`HumanInTheLoopRegistry` is shared between HITL and interrupts.**
Both reduce to "the bridge minted an `action_id` bound to a value;
when Slack delivers the click via `block_actions`, resolve the wait."
One registry, one Bolt `app.action(/.*/, …)` listener, two builders
on top.

**`render(state, api)` is the same shape across components, HITL, and
interrupts.** It mirrors React's `useCopilotAction({render: ({status,
…}) => …})` — apps think in one lifecycle. The bridge's
`applyRenderResult` is the universal "post / replace / delete" engine
both flows go through.

**`message-stream.ts` is the keystone of streaming.** Before the
extraction, streaming mechanics were tangled with the AG-UI subscriber
and two `chat.update`s could race; serialising through one queue
made the race impossible by construction.

**The agent backend never learned about Slack.** `interrupt_agent.py`
emits `interrupt({...})` exactly the way the React showcase does, the
AG-UI `ag_ui_langgraph` adapter emits `on_interrupt`, the bridge does
the rest. Same applies to the LangGraph + CopilotKit middleware
forwarding `tools` and `context` from `runAgent({tools, context})`
into the agent's tool list / system message — no changes to the
showcase Python code.

## What's intentionally _not_ abstracted

- No generic "Sink" between AG-UI events and the renderer. Slack is
  the only renderer; abstraction would just be ceremony.
- No abstract over Bolt. If you're using this package, you're talking
  to Slack.
- No durable bridge state. The next turn rebuilds from Slack history;
  restarts are safe by construction.

## Failure model

| Failure                                          | Behaviour                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Single `chat.update` fails                       | logged, swallowed; next append retries with latest buffer                                                      |
| Agent run throws (network, etc.)                 | caught in `turn-runner`, `:warning:` posted unless intentionally aborted                                       |
| Agent emits `RUN_ERROR`                          | `:warning:` posted via renderer (skipped on intentional abort)                                                 |
| `on_interrupt` arrives but no handler registered | warning logged, graph stays paused                                                                             |
| `on_interrupt` payload fails schema validation   | warning logged, graph stays paused                                                                             |
| New user turn during a HITL/interrupt wait       | wait resolves with `{kind:"cancelled"}`; previous run's partial reply gets `_(interrupted)_` suffix            |
| Slack disconnect (Socket Mode)                   | Bolt auto-reconnects                                                                                           |
| Process restart                                  | next turn rebuilds context from Slack history; in-flight HITL/interrupt waits are lost (registry is in-memory) |
| Slack 429 / 5xx                                  | swallowed today; future: respect `Retry-After`                                                                 |

## Test surface

- `src/__tests__/` — vitest unit tests covering listener filters,
  conversation-store fold logic, message-stream queue invariants,
  chunking, auto-close, markdown→mrkdwn, frontend-tool plumbing,
  HITL registry + lifecycle, interrupt capture, built-ins. ~400ms.
- `examples/slack/app/tools/__tests__/` — example-tool test as a
  template for unit-testing app-level tools.
- `examples/slack/e2e/` — live harness. Drives Slack via `chat.postMessage` with a
  user OAuth token (`xoxp-`), polls `conversations.replies` while
  streams are in flight, runs per-case assertions (text contents,
  bracket balance, block count, fallback strings, etc.).
- `PROTO_E2E.md` — case catalog organised by technical axis.
