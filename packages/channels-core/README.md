# @copilotkit/channels-core

The supported platform-neutral foundation behind `@copilotkit/channels`.
Most applications should use the batteries-included `@copilotkit/channels` package;
install core directly when building an adapter or intentionally selecting one platform.

**Channels run through a channel runner.** CopilotKit Intelligence provides the
managed runner, available on a free plan: the `CopilotRuntime` starts and owns
each Channel once Intelligence is configured — see "Running a Channel" below.
Building and operating your own channel runner on the SDK primitives is also a
supported path; teams choosing it own their state, persistence, concurrency,
locking, retries, and race-condition handling.

## Selective install

```sh
pnpm add @copilotkit/channels-core @copilotkit/channels-slack
```

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@copilotkit/channels-core"
  }
}
```

```ts
import { createChannel } from "@copilotkit/channels-core";
import { slack } from "@copilotkit/channels-slack";
```

`createChannel(opts)` returns a `Channel`:

- `onMention(handler)` / `onMessage(handler)` — turn handlers receiving
  `{ thread, message }`. Bot mentions select `onMention` when registered and
  otherwise fall back to `onMessage`; other content selects `onMessage`.
- `onThreadStarted(handler)` — a conversation surface opened (e.g. the Slack
  assistant pane); receives `{ thread, user, actor }`. Greet, set suggested prompts
  or a title, or run the agent. Adapters without the concept never fire it.
- `onWelcome(handler)` — a provider installation or conversation activation;
  receives `{ thread, user?, platform }`. Adapters without a reliable
  activation event never fire it.
- `onInteraction<TValue>(id, handler)` — explicit escape-hatch handler for a
  known action id, bypassing the registry; `ctx.action.value` is typed `TValue`.
- `onInterrupt<TPayload>(eventName, handler)` — handle a captured agent
  interrupt (LangGraph-style `on_interrupt`); receives `{ payload, thread, user, actor }`
  with `payload` typed `TPayload`.
- `onCommand(command)` / `onCommand(name, handler)` — register a slash command.
  The handler gets `{ thread, command, text, options, user, actor }`. `text` is the
  raw args (Slack); `options` is the typed, parsed form (`defineChannelCommand`
  with an `options` Standard Schema) for surfaces with native structured args
  (e.g. Discord). This is a direct-adapter capability: managed Slack and Teams
  treat leading-slash text as ordinary message content and do not register
  provider slash commands. Forwarded to direct adapters that support commands
  and ignored elsewhere — also pass them up front via `commands` in
  `CreateChannelOptions`.
- `tool(t)` — register a `ChannelTool` (alternative to `opts.tools`); must be
  added before the runtime activates the channel.

`agent` is optional. If omitted, calling `thread.runAgent()` throws; supply
an `AbstractAgent` or a `(threadId) => AbstractAgent` factory.

A `Channel` has no public `start()` / `stop()` — lifecycle is runtime-owned
(see below).

## Running a Channel

In the managed path, a Channel runs when it's declared on an
Intelligence-configured `CopilotRuntime`. Pass the `Channel` in `channels`,
then drive activation through the returned handler:

```ts
import { createChannel } from "@copilotkit/channels-core";
import { slack } from "@copilotkit/channels-slack";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

const channel = createChannel({
  name: "support-bot", // project-unique Intelligence Channel name
  identifyUser: "platform",
  adapters: [slack({ botToken, appToken })],
});

const runtime = new CopilotRuntime({
  intelligence: new CopilotKitIntelligence({
    // apiUrl and wsUrl default to cloud-hosted CopilotKit Intelligence — override
    // both together only for a self-hosted deployment.
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY!, // free tier available
  }),
  channels: [channel],
});

// Creating the listener starts every declared channel's connection.
const listener = createCopilotNodeListener({ runtime });
// Optional: await that activation so a broken config fails startup loudly.
await listener.channels.ready();
// await listener.channels.stop(); // tears them down
```

The runtime also declares managed Slack and Teams for the same Channel name.
Developer-owned adapters stay in the adapter array and may run alongside that
managed adapter. If managed setup is incomplete, configured direct adapters
still start while `listener.channels.status()` reports `setup_required` for the
managed path.

## `Thread`

A `Thread` is the per-conversation handle handed to your handlers and tool
contexts. It accepts any `Renderable` (JSX or a string) for posting.

```ts
interface Thread {
  readonly platform: string;
  post(ui: Renderable): Promise<MessageRef>;
  update(ref: MessageRef, ui: Renderable): Promise<MessageRef>;
  delete(ref: MessageRef): Promise<void>;
  stream(src: string | AsyncIterable<string>): Promise<MessageRef>;
  runAgent(input?: {
    context?: ContextEntry[];
    tools?: ChannelTool[];
    memory?: MemoryGrant;
  }): Promise<MessageRef | undefined>;
  resume(
    value: unknown,
    options?: {
      memory?: MemoryGrant;
      subject?: "initiator" | "actor";
      answerableBy?: "initiator" | "conversation";
    },
  ): Promise<MessageRef | undefined>;
  assertCanResume(options?: {
    memory?: MemoryGrant;
    subject?: "initiator" | "actor";
    answerableBy?: "initiator" | "conversation";
  }): Promise<void>;
  awaitChoice<T = unknown>(
    ui: Renderable,
    options?: {
      answerableBy?: "initiator" | "conversation";
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<T>;
  // Capability-gated (return { ok: false } on surfaces without support):
  setSuggestedPrompts(
    prompts: ReadonlyArray<{ title: string; message: string }>,
    opts?: { title?: string },
  ): Promise<{ ok: boolean; error?: string }>;
  setTitle(title: string): Promise<{ ok: boolean; error?: string }>;
}
```

- `post` / `update` render the JSX to IR, **bind** every event-prop handler
  in the tree (mint a content-stable id, snapshot it, rewrite the prop to
  `{ id }`), then hand the IR to the adapter.
- `runAgent` resolves the conversation's agent session, creates the adapter's
  `RunRenderer`, and drives the run/tool/interrupt loop. Per-run `tools` /
  `context` are merged on top of the channel-level defaults for that run only.
- `resume(value)` re-enters a paused interrupt run with
  `forwardedProps.command`. By default only the provider account that started
  the run chain may resume: a click from anyone else is refused with
  `ActionInitiatorMismatchError` and leaves the action usable. The match is by
  id whatever the actor's kind, so a bot-started chain needs
  `answerableBy: "conversation"` for people to resume it. Only one control
  rendered during a run can resume it; the others, and a repeat click, get
  `ActionAlreadyClaimedError`.
- `assertCanResume(options?)` refuses as `resume` would and consumes nothing.
  Call it before updating a card.
- `awaitChoice<T>(ui, options?)` posts a picker and blocks until a click on one
  of the picker's own controls resolves it (HITL); pass `T` to type the
  returned value. See [Waiting for a choice](#waiting-for-a-choice).

### Waiting for a choice

`awaitChoice` resolves with the value the picker itself offered for the
clicked control: a button's `value`, the matching option(s) of a select, or
the text typed into an input. Clicks on any other control (an earlier card, a
stale picker, an unrelated select) never answer it, and a select value the
picker does not offer is refused.

- `answerableBy` decides who may answer. `"initiator"` (the default, set by
  `DEFAULT_AWAIT_CHOICE_ANSWERABLE_BY`) accepts only the provider account that
  started the turn, matched by its id; the actor's `kind` is never consulted,
  so a turn started by a bot is answerable only by that bot. When the turn's
  actor has no id, the call rejects at once with
  `ChannelChoiceInitiatorUnknownError` (`channel_choice_initiator_unknown`).
  `"conversation"` accepts anyone in the conversation the picker was posted
  to, still only through the picker's own controls.
- `timeoutMs` bounds the wait (default `DEFAULT_AWAIT_CHOICE_TIMEOUT_MS`, one
  hour; `Infinity` for no limit). On timeout the choice rejects with
  `ChannelChoiceTimeoutError` (`channel_choice_timeout`). A finite timeout
  must be at most 2147483647 ms (2^31-1, about 24.8 days, the longest delay a
  timer holds); a larger one rejects at once with a `RangeError`.
- `signal` aborts the wait: the choice rejects with `ChannelChoiceAbortedError`
  (`channel_choice_aborted`).

Pending choices live in the process that posted the picker. With several
replicas, a click the owner makes on another replica runs the control's handler
but cannot settle the choice, because the state store has no way to notify the
first process. The choice stays pending until `timeoutMs`, so keep clicks on the
posting process (sticky routing) or set a timeout you can act on.

A conversation has one pending choice at a time: a newer `awaitChoice` there
rejects the older one with `ChannelChoiceSupersededError`
(`channel_choice_superseded`). If the clicked control's own `onClick` throws,
the choice rejects with that error. Once a choice settles, its picker's
controls neither run nor answer anything.

## Tools & context

A `ChannelTool` is forwarded to the agent as a frontend tool; its handler runs in
the channel when the agent calls it. The handler `ctx` carries the `thread`, so a
tool can render JSX (`ctx.thread.post(<Card .../>)`) or run the agent further.

```ts
interface ChannelTool<Schema extends ObjectSchema = ObjectSchema> {
  name: string;
  description: string;
  parameters: Schema; // any Standard Schema (Zod/Valibot/ArkType/…)
  handler(args, ctx: ChannelToolContext): Promise<unknown> | unknown;
}
```

Define one with the non-curried `defineChannelTool`, which infers the arg types
from `parameters`:

```ts
defineChannelTool({
  name: "read_thread",
  description: "Read the messages in the current conversation.",
  parameters: z.object({}),
  async handler(_args, { thread }) {
    return await thread.getMessages();
  },
});
```

`parameters` (a Standard Schema) is converted to JSON Schema for the LLM and
validated on the way back. `ChannelToolContext` is `{ thread, message?, user?,
signal?, platform }` — a single shared type with no per-adapter generic.
Platform-specific power is reached only through capability-gated `thread`
methods (e.g. `thread.getMessages()`, `thread.lookupUser(query)`,
`thread.postFile(...)`), so a tool stays portable across surfaces.

A `ContextEntry` is `{ description: string; value: string }` — knowledge
folded into the agent's system context on each `runAgent`.

## Agent-rendered components

`defineChannelComponent` turns a server-rendered JSX function into an agent
tool. Its Standard Schema validates tool args before `render` runs. The render
context supplies the source `platform` and the run's `AbortSignal`.

```tsx
import { createChannel, defineChannelComponent } from "@copilotkit/channels";
import { z } from "zod";

const Approval = defineChannelComponent({
  name: "show_approval",
  description: "Post an approval request.",
  parameters: z.object({ title: z.string() }),
  render: ({ title }, { platform, signal }) => (
    <Card title={`${title} (${platform})`}>
      <Button key="approve" value="approve" onClick={approve}>
        Approve
      </Button>
    </Card>
  ),
});

const channel = createChannel({
  name: "approvals",
  components: [Approval],
});
```

When the agent calls `show_approval`, Channels posts the rendered message as a
separate provider message and returns a short tool acknowledgement. The agent
run then continues. Interactive nodes in a component definition need stable,
unique JSX keys. Channels stores those keys with the source platform and action
value, so a click or reaction can recover the same handler after a restart.
Legacy `components: { Name: Component }` registrations still use positional
recovery for old snapshots.

## ActionStore

Each rendered interactive node gets a fresh **random, opaque** action id
(`mintActionId()`: `"ck:"` + 128 random bits, base64url). Only the opaque id
(plus any small `bind()` args) is stamped on the native token; no props, PII,
or secrets go over the wire.

Every action is bound to the conversation and platform it was posted to. A
click is dispatched only when it arrives from that same conversation and
platform (`ActionRegistry.dispatch(id, ctx, { conversationKey, platform })`,
both taken from the ingress event); anything else is refused with
`ActionScopeMismatchError`. `<Message onReaction>` handlers are scoped the same
way.

On a click, the `ActionRegistry` resolves the handler from a hot in-memory
cache; on a miss it **rehydrates** by loading the snapshot from the
`ActionStore`, re-rendering the named component with the frozen props, and
re-walking to the handler's path.

Only a component registered by name (`createChannel({ components })`, or
`ActionRegistry.registerComponent(name, fn)`) is rehydrated: a posted
`<Component />` element binds under the name it was registered with. A name
identifies exactly one component, so registering it for a different one, or
one component under two names, throws. An element of an unregistered
function binds inline, like a plain tree: once its in-process cache entry is
gone (restart or eviction), a click on it reports `ActionExpiredError`. A
function's own `name` is never used, because two functions can share it.

Actions are retained for `actionRetentionMs` (default 7 days,
`DEFAULT_ACTION_RETENTION_MS`): every stored snapshot is written with that TTL,
and the in-process cache expires its entries after it too and holds at most
`DEFAULT_MAX_HOT_ACTIONS` (10,000) of them, evicting the least recently used.

The default `ActionStore` is `InMemoryActionStore` (a `Map` with optional
TTL). It is lost on restart: after a restart an old button click degrades to
an `ActionExpiredError`. `createChannel` logs it at warn and, where the
platform has native ephemeral messages, tells the clicker "This action has
expired." A click on a control that never had an action (a link button, a
button without a handler) carries a fallback id rather than a minted `ck:` id,
and is ignored quietly (debug log).
**Durable actions require an external store (Redis / DB) — not shipped in
v1.** Implement the `ActionStore` interface (`put` / `get` / `delete`) and
pass it as `actionStore` to make actions survive restarts.

## Writing a `PlatformAdapter`

To target a new surface, implement `PlatformAdapter` from this package. The
engine drives ingress through the `IngressSink` you receive in `start(sink)`
(`sink.onTurn(IncomingTurn)` / `sink.onInteraction(InteractionEvent)` /
`sink.onCommand(IncomingCommand)` / `sink.onThreadStarted(IncomingThreadStart)`)
and egress through your `post` / `update` / `stream` / `delete` (which receive
`ChannelNode[]` to translate to a native payload via `render`). You also provide
`createRunRenderer(target)` (an AG-UI `RunRenderer`: the subscriber to stream
into, plus accessors for captured tool calls and interrupts that the run-loop
reads after each `runAgent`), `decodeInteraction(raw)` (native event → opaque
`InteractionEvent`), `lookupUser`, a `conversationStore`
(`getOrCreate` → `AgentSession`), and the surface `capabilities` /
`ackDeadlineMs`. Optional capability methods like `getMessages(target)` and
`postFile(target, args)` back the matching `thread` methods when the surface
supports them — likewise `setSuggestedPrompts(target, prompts, opts?)` and
`setThreadTitle(target, title)` back `thread.setSuggestedPrompts` /
`thread.setTitle`, `sink.onWelcome(...)` emits a reliable installation or
activation event, and `sink.onThreadStarted(...)` emits the "conversation
opened" lifecycle event. Direct-adapter slash commands are also capability-gated: an adapter forwards
invocations via `sink.onCommand(IncomingCommand)`, and may implement
`registerCommands(specs)` to publish the channel's declared commands up front
(e.g. Discord's application-command API); adapters that omit it are skipped.
If a click (or reaction) on a message you posted is keyed by a different
`conversationKey` than the turn that posted it (Slack keys a click on a
top-level message by that message's own ts), implement
`postedConversationKey(target, posted, kind)` so the engine scopes the
message's actions to the key your `decodeInteraction` will report.
See `@copilotkit/channels-slack` for a complete implementation.

## Exports

`createChannel`, `Channel`, `CreateChannelOptions`, `ChannelHandler`,
`WelcomeHandler`, `ThreadStartHandler`;
`Thread`; the `PlatformAdapter` boundary types (`RunRenderer`, `IngressSink`,
`IncomingTurn`, `InteractionEvent`, `IncomingCommand`, `IncomingWelcome`,
`IncomingThreadStart`,
`SurfaceCapabilities`,
`ReplyTarget`, `ConversationStore`, `AgentSession`, `CapturedToolCall`,
`CapturedInterrupt`, `UserQuery`); `ActionStore` / `InMemoryActionStore` /
`ActionSnapshot` / `ActionRegistry` / `ActionExpiredError`; `ChannelTool` /
`ChannelToolContext` / `defineChannelTool` / `ChannelCommand` / `CommandContext` /
`CommandSpec` / `defineChannelCommand` / `ContextEntry` /
`AgentToolDescriptor` / `ObjectSchema` and the tool helpers
(`toAgentToolDescriptors`, `parseToolArgs`, `stringifyHandlerResult`);
`mintId` / `stableStringify`; `runAgentLoop`; plus the re-exported
`@copilotkit/channels-ui` vocabulary.
