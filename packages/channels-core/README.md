# @copilotkit/channels-core

The supported platform-neutral foundation behind `@copilotkit/channels`.
Most applications should use the batteries-included `@copilotkit/channels` package;
install core directly when building an adapter or intentionally selecting one platform.

> **Beta / breaking change.** As of this release adapters are **declarative and
> credential-free** — `slack()`, not `slack({ botToken, appToken })` — and a
> `Channel` no longer starts itself. Credentials and connectivity are supplied
> by CopilotKit Intelligence (the recommended path) or a custom Channel runner.
> See the quick start below. (Old: `slack({ …tokens })` + `channel.start()`;
> new: `slack()` + `new CopilotRuntime({ intelligence, channels })`.)

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

## Quick start

```ts
import { createChannel } from "@copilotkit/channels-core";
import { slack } from "@copilotkit/channels-slack";
import { CopilotRuntime } from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const support = createChannel({
  name: "support",
  agent: new HttpAgent({ url: process.env.AGENT_URL! }), // or "billing" | router | omitted → "default"
  adapters: [slack()], // credential-free
});

support.onMention(async ({ thread, message }) => {
  await thread.react(message.ref, "eyes");
  await thread.runAgent({ prompt: message.contentParts ?? message.text });
});

// CopilotKit Intelligence supplies credentials, connectivity, delivery, and failover:
const runtime = new CopilotRuntime({
  intelligence,
  identifyUser,
  channels: [support],
});
```

`createChannel(opts)` returns a `Channel`. Everything below `name`/`agent`/`adapters`
is optional and shared across every provider README (`tools`, `context`, `commands`,
`components`, `store`, `concurrency`).

### `agent` — four binding modes

`agent` picks which Runtime agent this Channel drives. The old per-thread
factory (`agent: (threadId) => makeAgent(threadId)`) is **removed**. Instead:

- `agent: new HttpAgent({ url })` (or any `AbstractAgent`) — a fixed inline
  agent; the Runtime clones it per run.
- `agent: "billing"` — a named agent looked up in `runtime.agents`.
- `agent: ({ user, event }) => "billing"` — a router that selects a named
  agent per turn from a bounded, side-effect-free `ChannelAgentRouteContext`
  (channel name, platform, turn id, conversation kind/key, safe user fields,
  a normalized `event`, and an `AbortSignal` — never raw provider payloads,
  credentials, or unbounded history).
- omitted — the Runtime agent named `"default"`.

Named, routed, and default bindings can only be resolved by a Runtime
(`CopilotRuntime`) — calling `thread.runAgent()` on a channel using one of
those modes without going through a Runtime throws. Only the inline
`AbstractAgent` mode works standalone (e.g. in tests).

### Other `CreateChannelOptions`

- `name` — project-unique Channel name. Required to run through CopilotKit
  Intelligence (it ties the declaration to the Intelligence setup); optional
  for a standalone/custom-runner Channel.
- `adapters` — direct `PlatformAdapter`s (e.g. `slack()`, `discord()`). A
  Channel with no adapters is _managed_ — CopilotKit Intelligence supplies
  delivery for it instead.
- `provider` — which managed platform a no-adapter Channel targets when
  activated via Intelligence (`"slack"` | `"teams"`; defaults to `"slack"`).
  Ignored for direct-adapter Channels.
- `concurrency` — `{ onConcurrent: "replace" | "queue" | "drop" }`, what to do
  when a new turn arrives while a prior turn on the same conversation is still
  running. Default `"replace"`.
- `tools` — `ChannelTool[]` forwarded to the agent as frontend tools (see
  below).
- `context` — `ContextEntry[]`, knowledge folded into the agent's system
  context on every `runAgent`.
- `components` — named JSX components used in interactive messages; register
  them here so a click on a message posted before a restart still resolves
  (durable actions) instead of degrading to "action expired".
- `commands` — slash commands, forwarded to adapters that support them.
- `store` — persistence and per-thread state:
  - `store.adapter` — pluggable `StateStore` (defaults to in-memory,
    lost on restart).
  - `store.state` — a Standard Schema for per-thread state; when set,
    `thread.state()` / `thread.setState()` are typed to its output and
    `setState` validates at runtime.
  - `store.identity` / `store.transcripts` — cross-platform identity
    resolution + transcript storage (must be configured together).
  - `store.onLockConflict`, `store.lockTtl`, `store.dedupTtl` — turn-lock and
    inbound-event-dedup tuning.

`createChannel(opts)` returns a `Channel`:

- `onMention(handler)` / `onMessage(handler)` — turn handlers receiving
  `{ thread, message }`.
- `onThreadStarted(handler)` — a conversation surface opened (e.g. the Slack
  assistant pane); receives `{ thread, user? }`. Greet, set suggested prompts
  or a title, or run the agent. Adapters without the concept never fire it.
- `onInteraction<TValue>(id, handler)` — explicit escape-hatch handler for a
  known action id, bypassing the registry; `ctx.action.value` is typed `TValue`.
- `onInterrupt<TPayload>(eventName, handler)` — handle a captured agent
  interrupt (LangGraph-style `on_interrupt`); receives `{ payload, thread }`
  with `payload` typed `TPayload`.
- `onCommand(command)` / `onCommand(name, handler)` — register a slash command.
  The handler gets `{ thread, command, text, options, user }`. `text` is the
  raw args (Slack); `options` is the typed, parsed form (`defineChannelCommand`
  with an `options` Standard Schema) for surfaces with native structured args
  (e.g. Discord). Forwarded to adapters that support commands and ignored
  elsewhere — also pass them up front via `commands` in `CreateChannelOptions`.
- `onReaction(handler)` / `onReaction(emoji, handler)` — react to emoji
  reactions; omit `emoji` for a catch-all.
- `onModalSubmit(callbackId, handler)` / `onModalClose(callbackId, handler)`
  — handle a modal submission/dismissal.
- `tool(t)` — register a `ChannelTool` (alternative to `opts.tools`).
- `transcripts` — the cross-platform transcript store (available once the
  Channel is running).

There is no public `start()` / `stop()` / `addAdapter()` — the Runtime drives
a Channel's lifecycle. You declare Channels on `CopilotRuntime`; you don't
start them yourself.

## Who supplies credentials and runs the Channel

Adapters like `slack()` are declarative and credential-free — no bot token,
app token, or signing secret is passed to the factory. Connectivity,
credentials, delivery, and failover are supplied by whatever drives the
Channel:

- **CopilotKit Intelligence** (recommended): pass your Channels to
  `new CopilotRuntime({ intelligence, identifyUser, channels: [support] })`.
  Configure the provider's credentials once in Intelligence (the connector),
  not in your code.
- **A custom Channel runner**: running Channels without CopilotKit
  Intelligence requires implementing a custom `ChannelRunner` (an advanced,
  exported-but-undocumented escape hatch that supplies its own connectivity,
  credentials, delivery, and failover).

## Response defaults

In a shared channel/thread, a message must be explicitly mentioned/tagged to
be considered addressed — a prior bot reply does **not** remove that
requirement. DMs and the assistant pane are already directly addressed. A
matching `onMention` handler wins over `onMessage`, and any matching handler
suppresses automatic agent execution. With no matching handler, an addressed
message auto-runs the selected agent. An untagged shared message is ignored
unless an `onMessage` handler opts in (`onMention` never fires for it).

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
  }): Promise<MessageRef | undefined>;
  resume(value: unknown): Promise<MessageRef | undefined>;
  awaitChoice<T = unknown>(ui: Renderable): Promise<T>;
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
  `forwardedProps.command`.
- `awaitChoice<T>(ui)` posts a picker and blocks until an interaction in this
  conversation resolves it to the clicked control's value (HITL); pass `T` to
  type the returned value.

Note: `thread.getMessages()` reads provider history on adapters that support
it (e.g. Slack, Discord) but falls back to an in-memory transcript on
adapters that don't.

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

## ActionStore

Inline JSX handlers are bound by content. Each interactive node gets a
**content-stable, opaque** minted id — `mintId(componentName, path, props)`
= `"ck:" + sha1(name | path | stableStringify(props)).slice(0,16)`. Only the
opaque id (plus any small `bind()` args) is stamped on the native token; no
props, PII, or secrets go over the wire.

On a click, the `ActionRegistry` resolves the handler from a hot in-memory
cache; on a miss it **rehydrates** by loading the snapshot from the
`ActionStore`, re-rendering the named component with the frozen props, and
re-walking to the handler's path.

The default `ActionStore` is `InMemoryActionStore` (a `Map` with optional
TTL). It is lost on restart: after a restart an old button click degrades to
an `ActionExpiredError` ("this action expired"), which `createChannel` swallows.
**Durable actions require an external store (Redis / DB) — not shipped in
v1.** Implement the `ActionStore` interface (`put` / `get` / `delete`) and
pass it as `store.adapter` to make actions survive restarts.

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
`thread.setTitle`, and `sink.onThreadStarted(...)` emits the "conversation
opened" lifecycle event. Slash commands are also capability-gated: an adapter forwards
invocations via `sink.onCommand(IncomingCommand)`, and may implement
`registerCommands(specs)` to publish the channel's declared commands up front
(e.g. Discord's application-command API); adapters that omit it are skipped.
See `@copilotkit/channels-slack` for a complete implementation.

Adapter authors are credential-free too: a `PlatformAdapter` describes _how_
to speak to a surface, not _which_ workspace/bot to speak to as — connectivity
and credentials come from whatever drives the Channel (Intelligence or a
custom runner).

## Exports

`createChannel`, `Channel`, `CreateChannelOptions`, `ChannelAgentBinding`,
`ChannelAgentRouter`, `ChannelAgentRouteContext`, `ChannelRouteEvent`,
`ChannelRouteUser`, `ChannelConversationKind`, `ChannelConcurrencyPolicy`,
`ChannelConcurrencyDecision`, `ManagedChannelProvider`, `ChannelHandler`,
`ThreadStartHandler`, `ReactionEvent`, `ReactionHandler`, `ModalSubmitEvent`,
`ModalSubmitHandler`, `ModalCloseEvent`, `ModalCloseHandler`, `StoreConfig`,
`LockConflictDecision`, `StatefulThread`, `ChannelComponent`;
`Thread`; the `PlatformAdapter` boundary types (`RunRenderer`, `IngressSink`,
`IncomingTurn`, `InteractionEvent`, `IncomingCommand`, `IncomingThreadStart`,
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
