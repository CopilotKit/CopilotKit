# Architecture

How `@copilotkit/channels-discord` is structured and **why** each boundary exists.

This package is the Discord `PlatformAdapter` for [`@copilotkit/channels`](../channels).
The channel engine owns the platform-agnostic orchestration (handlers, the
run/tool/interrupt loop, JSX action binding, the `ActionStore`); this package
owns everything Discord-specific: discord.js Gateway ingress, Components V2
egress, streaming, and opaque-id interactions.

## Design goals

1. **The agent doesn't know about Discord.** It receives ordinary AG-UI input
   and emits ordinary AG-UI events.
2. **Discord mechanics don't bleed into the engine.** `message.edit`
   throttling, Discord markdown translation, 2000-char chunking, interrupt
   capture, and `interactionCreate` routing all live behind the
   `PlatformAdapter` interface.
3. **One file, one job.** Each source file has a single responsibility.
4. **Failures are contained.** A failed `message.edit` doesn't crash the run.
5. **No durable Discord-side state.** Discord is the source of truth
   (`channel.messages.fetch`); the conversation store reconstructs each
   turn's `agent.messages` from Discord on the fly.

## The boundary: `PlatformAdapter`

`DiscordAdapter` (constructed via `discord(opts)`) implements
`@copilotkit/channels`'s `PlatformAdapter`. The members it implements:

- `platform` (`"discord"`), `capabilities` (`supportsModals: false`,
  `supportsTyping: true`, `supportsReactions: true`, `supportsStreaming: true`,
  `maxBlocksPerMessage: 40`), `ackDeadlineMs` (3000)
- `start(sink)` / `stop()` — login the discord.js `Client`, register slash
  commands on `ready`, wire `attachDiscordListener` and the
  `interactionCreate` handler, then push normalized events into the engine's
  `IngressSink`; `stop()` calls `client.destroy()`
- `render(ir)` — IR → Components V2 (`renderComponents`)
- `post` / `update` / `stream` / `delete` — egress via the discord.js channel
  API
- `createRunRenderer(target)` — the AG-UI `RunRenderer` for a run
- `decodeInteraction(raw)` — native `interactionCreate` payload →
  `InteractionEvent`
- `lookupUser(query)` — guild-member search across cached guilds for
  `@`-mention resolution (backs `thread.lookupUser`)
- `getMessages(target)` — the channel's messages via
  `channel.messages.fetch({ limit: 100 })` (backs `thread.getMessages`)
- `postFile(target, args)` — upload a file via `channel.send({ files: [...] })`
  (backs `thread.postFile`)
- `conversationStore` — in-memory `DiscordConversationStore`, keyed by
  channel id → `AgentSession`
- `registerCommands(commands)` — stashes `CommandSpec[]` for publication on
  `ready`

The engine drives ingress through the `IngressSink` it hands to `start`
(`sink.onTurn` / `sink.onCommand` / `sink.onInteraction`) and egress through
these methods.

## Request lifecycle

```
Discord Gateway event ──► attachDiscordListener ──► IngressSink.onTurn(IncomingTurn)
                                                               │
                                                               ▼
                                                     @copilotkit/channels: Thread
                                                               │  thread.runAgent()
                                                               ▼
                                                     runAgentLoop
         ┌───────────────────────────────────────────────────┴──────────────────────────────┐
         │ agent.runAgent(..., RunRenderer.subscriber)                                        │
         │   • event-renderer streams TEXT_MESSAGE_* → message.edit (Components V2 / plain)  │
         │   • captures frontend tool calls + on_interrupt custom events                      │
         └───────────────────────────────────────────────────┬──────────────────────────────┘
                                                               │
               ┌───────────────────────────────────────────────┼──────────────────────────────┐
               ▼ (captured tool call)                          ▼ (captured interrupt)           ▼ (done)
     tool.handler(args, ctx)                         onInterrupt handler                     finish
     renders JSX via thread.post                     posts picker via thread.post
     → renderDiscordMessage/renderComponents         → awaitChoice / thread.resume(value)
     → Components V2 posted to Discord                 re-enters runAgentLoop with
                                                        forwardedProps.command on resume

Interactions:
  interactionCreate ──► deferUpdate (≤3s) ──► decodeInteraction (customId: ck: / v:)
                                                        │
                           ┌────────────────────────────┼────────────────────┐
                           ▼                            ▼                    ▼
                  HITL waiter resolved         ActionRegistry.dispatch    expired
```

### Ingress

`attachDiscordListener` is the translation layer between Discord's Gateway
event model and the engine's domain. It listens on `messageCreate` and
`interactionCreate`. For messages it filters bot-authored messages, non-DM
messages that lack a bot mention, and emits a normalized `IncomingTurn`.
For slash commands it normalizes `ChatInputCommand` options into `rawOptions`
and emits `onCommand`.

Required Gateway intents: `Guilds`, `GuildMessages`, `MessageContent`
(privileged — must be enabled in the Developer Portal), `DirectMessages`
(with `Partials.Channel` to receive DMs), and `GuildMembers` (privileged —
must be enabled in the Developer Portal; powers user lookup / member search).

The `conversationKey` is the **channel id** for both guild channels and DMs.
Discord threads and DMs each have their own unique channel id, so no
additional scoping is needed.

### Run / render

`thread.runAgent` resolves the conversation's `AgentSession` from the
`conversationStore`, creates `createRunRenderer(target)`, and runs
`runAgentLoop`. The renderer (`event-renderer.ts`) subscribes to AG-UI
events: it calls `channel.sendTyping()` on `RUN_STARTED` (typing indicator
auto-expires after ~10 s; refreshed per run), lazily creates a
`ChunkedMessageStream` on the first `TEXT_MESSAGE_CONTENT`, accumulates
deltas through `autoCloseOpenMarkdown` + `discordMarkdown`, captures
frontend tool calls and `on_interrupt` custom events for the loop to read
after each `runAgent`.

### Tools

When the agent calls a registered frontend tool, the loop validates the args
(Standard Schema) and invokes `tool.handler(args, ctx)`. `ctx` is the single
shared `ChannelToolContext` (`{ thread, message?, user?, signal?, platform }`) —
there is no Discord-specific context. Discord power is reached only through
capability-gated `thread` methods the adapter backs (`getMessages`,
`lookupUser`, `postFile`). A render-tool handler renders JSX with
`thread.post(<Card .../>)`, which goes through the engine's action-binding
then `renderDiscordMessage` / `renderComponents` → Components V2.

### HITL & interrupts

`thread.awaitChoice(<Picker .../>)` posts a picker and blocks the engine's
waiter until a button click or select in that channel resolves it. A captured
agent interrupt is dispatched to the registered `onInterrupt` handler, which
posts a picker whose button `onClick` calls `thread.resume(value)`; the loop
re-enters with `forwardedProps.command`.

### Interactions

`client.on("interactionCreate")` acks every button/select click within ≤3s
via `i.deferUpdate()`, then `decodeInteraction` extracts the `customId` and
optional `v:<json>` bound value plus the channel ref, building an
`InteractionEvent`. The engine resolves it: an awaiting HITL waiter, or
`ActionRegistry.dispatch` — a hot-cache hit, or a cold-path re-render
rehydration (load the snapshot, re-render the named component with frozen
props, re-walk to the handler's path). A miss after restart degrades to
"this action expired."

Custom-id scheme: opaque `ck:…` ids are minted by the action registry;
value-only buttons use `v:<json>` as the `customId`. `decodeInteraction`
passes the raw `customId` through as the `InteractionEvent.id` — the engine
resolves ck:-prefixed ids against the `ActionRegistry` and interprets
`v:`-prefixed ids as bound values.

### Commands

`registerCommands` (called once on `ready`) publishes the adapter's
`CommandSpec[]` as Discord application commands via the REST API. When
`guildId` is set in `DiscordAdapterOptions`, commands are registered to that
guild only (instant propagation, for development); otherwise they are
registered globally (up to one hour to propagate). `jsonSchemaToDiscordOptions`
maps the `CommandSpec.options` JSON Schema to typed Discord
`ApplicationCommandOption` objects (string/integer/number/boolean; enum
members become `choices`).

### Native extras

- **Typing indicator.** `channel.sendTyping()` is called on every
  `RUN_STARTED` event. Best-effort — a failure is swallowed.
- **Reactions.** `supportsReactions: true` is advertised; reaction helpers
  are available to render-tool handlers via `thread` channel methods.

### Sender / files

`postFile` sends a file attachment via `channel.send({ files: [...] })`.
Discord bots cannot read user email addresses; `PlatformUser.email` is
always `undefined`.

## Preserved mechanics

These files carry over from (or are adapted from) the cross-platform and
channels-slack approach:

| File                        | Job                                                                      |
| --------------------------- | ------------------------------------------------------------------------ |
| `discord-listener.ts`       | Gateway events → normalized turns/commands; ingress filters.             |
| `conversation-store.ts`     | In-memory Discord-backed history reconstruction; keyed by channel id.    |
| `message-stream.ts`         | Per-message `message.edit` queue + ≥1100ms throttle (no update races).   |
| `chunked-message-stream.ts` | Multi-message chunking at 2000-char boundary; keeps fenced blocks whole. |
| `auto-close-streaming.ts`   | Closes dangling markdown brackets mid-stream (idempotent).               |
| `markdown.ts`               | GFM Markdown → Discord markdown; fences GFM tables as code blocks.       |
| `download-files.ts`         | Inbound Discord attachment download → AG-UI multimodal content parts.    |

## SDK files at a glance

```
src/
├── index.ts                    # public exports
├── adapter.ts                  # discord() factory + DiscordAdapter (PlatformAdapter impl) + discord.js wiring
├── event-renderer.ts           # createRunRenderer: AG-UI subscriber → stream + tool/interrupt capture
├── interaction.ts              # decodeInteraction (customId / v: unpack)
├── render/
│   ├── components-v2.ts        # renderComponents / renderDiscordMessage (IR → Components V2)
│   └── budget.ts               # DISCORD_LIMITS + truncate/clamp degradation
├── discord-listener.ts         # Gateway events → IncomingTurn / IncomingCommandRaw (filters)
├── conversation-store.ts       # In-memory Discord-backed conversation reconstruction
├── chunked-message-stream.ts   # multi-message chunking + markdown transform
├── message-stream.ts           # per-message message.edit queue + throttle
├── markdown.ts                 # md → Discord markdown (tables → fenced blocks)
├── auto-close-streaming.ts     # mid-stream bracket closer
├── download-files.ts           # inbound Discord attachment → multimodal content parts
├── commands.ts                 # registerCommands (guild/global) + jsonSchemaToDiscordOptions
├── built-in-tools.ts           # lookup_discord_user + defaultDiscordTools (as ChannelTools)
├── built-in-context.ts         # tagging / markdown / convo-model context entries
└── types.ts                    # IncomingTurn, ReplyTarget, conversationKeyOf
```

## What's intentionally _not_ abstracted

- **No abstraction over discord.js.** If you use this package, you're talking
  to Discord via discord.js directly.
- **No durable Discord-side state.** The next turn rebuilds context from
  Discord channel history; restarts are safe for conversation history by
  construction. (The engine's `ActionStore` is separately in-memory in v1,
  so inline interaction handlers expire on restart — see the `@copilotkit/channels`
  README.)
- **No modal support in v1.** `<Input>` components are modal-only on Discord
  and are skipped with a console warning. `supportsModals` is advertised as
  `false`.
