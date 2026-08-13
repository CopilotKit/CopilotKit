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
    // apiUrl and wsUrl default to the managed Intelligence platform — override
    // both together only for a self-hosted deployment.
    apiKey: process.env.COPILOTKIT_INTELLIGENCE_API_KEY!, // free tier available
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
    },
  ): Promise<MessageRef | undefined>;
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
tool. A normal Standard Schema validates complete tool args and renders once.
An `@copilotkit/schema` streaming checkpoint can also render partial props while
AG-UI tool arguments arrive. Slack and Teams replace one message as those props
change.

Install the core, UI, and schema packages used by this selective example:

```sh
pnpm add @copilotkit/channels-core @copilotkit/channels-ui @copilotkit/schema
```

```tsx
import {
  createChannel,
  defineChannelComponent,
} from "@copilotkit/channels-core";
import { Button, Card, Section } from "@copilotkit/channels-ui";
import { object, schema, streaming, string } from "@copilotkit/schema";

const Approval = defineChannelComponent({
  name: "show_approval",
  description: "Post an approval request.",
  parameters: schema(
    object({ title: schema(string(), streaming()) }),
    streaming(),
  ),
  getInitialState: () => ({ approved: false }),
  callbacks: {
    async approve(_args: null, { setState }) {
      await setState({ approved: true });
    },
  },
  render({ phase, props, state, callbacks, platform }) {
    if (phase === "failed") return <Section>Approval could not load.</Section>;
    return (
      <Card title={`${props.title ?? "Loading…"} (${platform})`}>
        <Button onClick={callbacks.approve(null)}>
          {state.approved ? "Approved" : "Approve"}
        </Button>
      </Card>
    );
  },
});

const channel = createChannel({
  name: "approvals",
  components: [Approval],
});
```

When the agent calls `show_approval`, Channels posts the first useful render,
updates that message in place, and waits for the final `ready` update before it
finishes the tool. Named callback bindings store JSON-safe arguments and the
exact rendered props, state, phase, and revision. `setState` only updates the
component; a callback must call `thread.runAgent()` or `thread.resume()` itself
when it wants agent work. Configure a durable `StateStore` if component state
and callbacks must survive a process restart.

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
