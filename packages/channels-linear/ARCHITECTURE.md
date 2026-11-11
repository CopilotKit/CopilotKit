# Architecture

How `@copilotkit/channels-linear` is structured, and why each boundary exists.

Application authors use this package with the product-facing
[`@copilotkit/channels`](../channels) umbrella. `LinearAdapter` implements
[`PlatformAdapter`](../channels-core) from
[`@copilotkit/channels-core`](../channels-core). The channel engine owns the
orchestration that is the same on every platform: handlers, the
run, tool, and interrupt loop, JSX action binding, and the `ActionStore`. This
package owns everything that is specific to Linear: webhook ingress, Agent API
egress, activity rendering, and the decoding of `select` picks.

## Design goals

1. **The agent does not know about Linear.** It receives ordinary AG-UI input
   and emits ordinary AG-UI events.
2. **Linear mechanics stay out of the engine.** Signature checks, the
   acknowledgement thought, activity rendering, pick decoding, and the `stop`
   signal all live behind the `PlatformAdapter` interface.
3. **One file, one job.** Each source file has a single responsibility.
4. **Failures are contained.** A failed activity post is logged. Only a failed
   final reply fails the run. A webhook event that the adapter cannot read
   gets `500`, so Linear retries the delivery.
5. **History comes from Linear.** The agent session is the source of truth.
   The adapter rebuilds `agent.messages` from the session activities on each
   turn, so no history store is necessary.

## The boundary: `PlatformAdapter`

`LinearAdapter` (made by `linear(opts)`) imports and implements
`PlatformAdapter` from `@copilotkit/channels-core`. `@copilotkit/channels` is
the umbrella that re-exports this package. It is not a dependency of the
adapter.

The members it implements:

- `platform` (`"linear"`), `capabilities`, and `ackDeadlineMs` (5000).
- `start(sink)` keeps the engine `IngressSink`. When `port` is set, it also
  starts the built-in `LinearWebhookServer`. `stop()` stops that server.
- `handleWebhook(request)` is the fetch-style webhook handler that hosts
  mount themselves.
- `render(ir)` turns IR into one activity (`renderLinearMessage`).
- `post` and `update` post an activity. `update` posts a new activity,
  because activities cannot be edited.
- `stream` buffers the full iterable, then posts one `response`.
- `delete` does nothing, because Linear has no API to delete an activity.
- `createRunRenderer(target)` returns the AG-UI `RunRenderer` for a run. The
  adapter tracks it per session, so a `stop` signal can silence it.
- `decodeInteraction(raw)` returns `undefined`. Picks arrive as `prompted`
  webhooks and ingress decodes them.
- `lookupUser(query)` returns `undefined`.
- `getMessages(target)` returns the session messages (backs
  `thread.getMessages`).
- `conversationStore` is a `LinearConversationStore`.

The engine drives ingress through the `IngressSink` it gives to `start`
(`sink.onTurn` and `sink.onInteraction`). It drives egress through the
members above.

## Request lifecycle

1. Linear sends a signed `AgentSessionEvent` POST to the webhook URL.
2. `createWebhookHandler` (`webhook.ts`) checks `Linear-Signature` and the
   60 s timestamp window. Then it awaits `onEvent`, which prepares the event.
   If prepare fails, the handler answers `500`, and Linear retries the
   delivery. Otherwise it answers `200` and runs the dispatch after the
   response.
3. `prepareAgentSessionEvent` (`ingress.ts`) prepares the event and returns
   its dispatch. The dispatch turns the event into a turn or an interaction
   for the sink.
4. On `created`, the dispatch first posts an ephemeral `thought` ("Looking
   into this…"). Linear marks an agent unresponsive when it posts nothing
   within 10 s.
5. `thread.runAgent()` gets an agent from `LinearConversationStore`, which
   rebuilds its messages from the session.
6. The run renderer (`event-renderer.ts`) posts activities as AG-UI messages
   end.
7. Tool handlers and `awaitChoice` post JSX through `thread.post(...)`, which
   goes through `renderLinearMessage` and `LinearApiClient.createActivity`.

### Ingress

`prepareAgentSessionEvent` is the translation layer between the Linear webhook
schema and the engine. The conversation key is
`conversationKeyOf(agentSessionId)`. The actor is the user who sent the
`prompted` activity, or the session creator on `created`.

- `created` becomes a turn. Its text is `promptContext` when Linear sends it.
  Otherwise it is the issue identifier, title, and description, plus the
  comment that started the session.
- `prompted` with the `stop` signal calls `onStop`. No turn starts.
- `prompted` whose body matches an option of the pending `select` set becomes
  an interaction. The pending set is then cleared.
- Any other `prompted` message becomes a turn.
- Other actions are ignored.

Ingress has two phases. Prepare runs before the webhook is answered. It reads
the pending `select` set and, when the reply picks an option, clears the set
as its last step. A failure in prepare answers `500`, and Linear retries the
delivery. Dispatch runs after the `200`. It calls the sink or `onStop`, and on
`created` it posts the first thought. The engine drops duplicate turns and
interactions inside the sink, so a retry after a failed prepare is not a
duplicate.

A new session can have no `prompt` activity yet, because the `created`
webhook carries the request only in its payload. The adapter calls
`conversationStore.primeSession(sessionId, text)`, and the first turn gets that
text as its last user message.

### Run and render

`createRunRenderer` subscribes to AG-UI events. Linear activities cannot be
edited, so it buffers each message and posts it once when the message ends:

- Text message: `response`. Text longer than `LINEAR_LIMITS.activityBody` is
  split into more activities, at a newline when possible.
- Reasoning message: ephemeral `thought`.
- Tool call end: `action` with the tool name and a one-line JSON summary of
  the arguments (at most 200 chars).
- Tool call result: the same `action` again, with `result`.
- Run error: `error`.

All posts run on one promise chain, so activities appear in event order. A
failed post is logged and kept for `getDeliveryError()`. It is never thrown
out of a subscriber hook. When the last post of the run failed, `finish()`
rejects with its error, so `thread.runAgent()` rejects too. Tool-call and interrupt capture match the other
channel renderers, so the run loop reads them the same way.

### Tools

When the agent calls a registered frontend tool, the loop checks the
arguments (Standard Schema) and calls `tool.handler(args, ctx)`. `ctx` is the
shared `ChannelToolContext`. There is no Linear-specific context. A tool that
renders JSX calls `thread.post(<Card ... />)`. The engine binds the actions,
then `renderLinearMessage` turns the IR into an activity.

### Choices and interrupts

Linear has one native choice surface: an `elicitation` activity with the
`select` signal. `renderLinearMessage` turns every `Button` and every
`Select` option into one option of that signal. It also returns `choices`,
which map each option value back to an action id and a value.

1. `postToSession` posts the elicitation and stores the choices in the
   adapter `stateStore` (`pending-choices.ts`). The key is the session id, and
   the time to live is one hour.
2. Linear shows the options. A pick comes back as a `prompted` webhook whose
   body is the option value.
3. `decodeSelectReply` (`interaction.ts`) matches the body to an option by
   value, or by label without case. A match becomes an `InteractionEvent`.
4. The engine resolves the `awaitChoice` waiter or dispatches the `onClick`
   handler.

A button with a `value` and no `onClick` (for example an `awaitChoice` confirm
pair without handlers) resolves under `LINEAR_VALUE_ONLY_ID`.

A captured agent interrupt goes to the `onInterrupt` handler. That handler
posts a picker whose `onClick` calls `thread.resume(value)`, and the loop
continues with `forwardedProps.command`.

The adapter state is separate from the engine `stateStore`. Its default is
`MemoryStore`. `thread.awaitChoice` waits inside the process that posted the
elicitation, so the user's pick must reach that same process. Run one instance,
or send each workspace's webhooks to the same instance. A shared `stateStore`
does not change this.

### Stop

A `prompted` activity with the `stop` signal calls `stopSession`:

1. `conversationStore.abortSession` aborts the running agent of the session.
2. The tracked run renderer's `markInterrupted()` drops queued activities.
   Later events post nothing.

Linear sets the session status from the last activity, so the adapter then
posts one final `Stopped.` response. Without it the session stays at
"stopping". The renderer stays registered until its posts settle, so
`Stopped.` always comes after the last activity of the run.

The running agent lives in the process that received the turn. A stop that
reaches a different process aborts nothing there, but it still posts
`Stopped.`. Run one instance, or send each workspace's webhooks to the same
instance.

### History

`LinearConversationStore` reads the session through
`LinearApiClient.getSession`: up to 10 pages of 100 activities. It makes a
fresh agent per turn (thread id `linear-<sessionId>-<uuid>`) and sets its
messages:

- An issue context message comes first when the session is on an issue.
- `prompt` activities are user messages.
- `response` and `elicitation` activities are assistant messages.
- `thought`, `action`, and `error` activities are left out.

It keeps the newest 50 messages. The inbound prompt is already a session
activity, so `seedsInboundTurn` is true.

## What differs from WhatsApp

| Concern    | WhatsApp                                   | Linear                                                                           |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| Ingress    | Signed webhook, GET verification handshake | Signed webhook with a 60 s timestamp window                                      |
| Trigger    | Every inbound message                      | A mention or a delegation (`created`), then `prompted`                           |
| Egress     | Text and interactive messages              | Typed agent activities (`response`, `thought`, `action`, `elicitation`, `error`) |
| Tool calls | Not shown to the user                      | Shown as `action` activities with results                                        |
| History    | Held in the adapter `HistoryStore`         | Read from the agent session on each turn                                         |
| Choices    | Reply buttons or list, opaque-id decoding  | `select` elicitation, pick decoded from the next prompt                          |
| Stop       | No stop signal                             | `stop` signal aborts the run                                                     |

## SDK files at a glance

```
src/
├── index.ts                  # public exports
├── adapter.ts                # linear() factory + LinearAdapter (PlatformAdapter impl)
├── types.ts                  # options, ReplyTarget, activity and webhook types
├── webhook.ts                # createWebhookHandler: checks, awaited prepare (500 on failure), dispatch after the 200
├── webhook-server.ts         # LinearWebhookServer: optional node:http wrapper
├── ingress.ts                # AgentSessionEvent: prepare, then dispatch to onTurn / onInteraction / onStop
├── interaction.ts            # conversationKeyOf + decodeSelectReply
├── pending-choices.ts        # pending select options in the adapter stateStore
├── event-renderer.ts         # createRunRenderer: AG-UI events -> activities
├── conversation-store.ts     # LinearConversationStore: session activities -> agent messages
├── client.ts                 # LinearApiClient: GraphQL over fetch, LinearApiError
├── built-in-context.ts       # formatting + delivery context entries
└── render/
    ├── message.ts            # renderLinearMessage: IR -> response or select elicitation
    └── budget.ts             # LINEAR_LIMITS + truncateText
```

## What is intentionally not abstracted

- **No abstraction over the Agent API.** This package talks to the Linear
  GraphQL API with only the operations it needs.
- **No retries in the client.** `LinearApiClient` never sleeps or retries.
  `LinearApiError` exposes `rateLimited` and `retryAfterMs` for callers.
- **No built-in token refresh.** `accessToken` can be a function. The client
  calls it before every request, so the host gets and refreshes the token.
- **No plain-comment bot mode.** The agent works only through agent sessions.
