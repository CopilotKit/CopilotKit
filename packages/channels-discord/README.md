# @copilotkit/channels-discord

The **Discord `PlatformAdapter`** for [`@copilotkit/channels`](../channels). It connects a
Discord application to any AG-UI agent: ingress via discord.js (Gateway), egress
as Components V2 rendered from the `@copilotkit/channels-ui` JSX vocabulary, plus text
streaming, opaque-id interactions, and HITL.

You write your UI as JSX once (`@copilotkit/channels-ui`) and drive the bot with
`@copilotkit/channels`; this package is the only one that talks to Discord.

The adapter keeps its own Discord credentials (`botToken` / `appId` / …) — but
the Channel itself only runs inside a CopilotKit Intelligence-configured
`CopilotRuntime` (an API key; a free tier is available). There is no
standalone / DIY runner and no `channel.start()`; the runtime starts and owns
the channel because Intelligence is configured.

## Install

```sh
pnpm add @copilotkit/channels-discord @copilotkit/channels @copilotkit/channels-ui
```

## Quickstart

```ts
import { createChannel } from "@copilotkit/channels";
import {
  discord,
  defaultDiscordTools,
  defaultDiscordContext,
} from "@copilotkit/channels-discord";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const bot = createChannel({
  name: "support-bot", // project-unique Intelligence Channel name
  adapters: [
    discord({
      botToken: process.env.DISCORD_BOT_TOKEN!, // Bot token — Gateway + REST
      appId: process.env.DISCORD_APP_ID!, // Application ID for command registration
      guildId: process.env.DISCORD_GUILD_ID, // Optional: instant guild-scoped dev commands
    }),
  ],
  agent: (threadId) => makeAgent(threadId),
  tools: [...defaultDiscordTools, ...appTools], // lookup_discord_user + your tools
  context: [...defaultDiscordContext, ...appContext], // tagging/formatting/thread guidance
  commands: [
    {
      name: "triage",
      description: "Summarize the thread and propose issues.",
      async handler({ thread, text }) {
        await thread.runAgent({ prompt: `Triage: ${text}` });
      },
    },
  ],
});

bot.onMention(({ thread }) => thread.runAgent());

// The runtime owns the channel's lifecycle — there is no `bot.start()`.
const runtime = new CopilotRuntime({
  intelligence: new CopilotKitIntelligence({
    apiUrl: "https://api.copilotkit.ai",
    wsUrl: "wss://api.copilotkit.ai",
    apiKey: process.env.COPILOTKIT_INTELLIGENCE_API_KEY!, // free tier available
  }),
  identifyUser: async () => ({ id: "support-bot", name: "Support Bot" }),
  channels: [bot],
});

const handler = createCopilotRuntimeHandler({ runtime });
await handler.channels.ready(); // starts the channel; handler.channels.stop() tears it down
```

`discord(opts)` returns a `DiscordAdapter`. The adapter connects via the
Discord Gateway (WebSocket) — no public URL required. The listener pre-filters
ingress to the turns the bot should answer (@-mentions in guild channels and
DMs), so a single `onMention` handler covers most use cases.

### Required env

| Var                 | Purpose                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| `DISCORD_BOT_TOKEN` | Bot token for Gateway login and REST calls.                              |
| `DISCORD_APP_ID`    | Application ID used when registering slash commands.                     |
| `DISCORD_GUILD_ID`  | _(Optional)_ Guild ID for instant per-guild command registration in dev. |

> **Global commands** (no `guildId`) propagate across Discord in ~1 hour.
> **Guild-scoped commands** (with `guildId`) register instantly — use them
> during development and switch to global for production.

### Privileged intents

The adapter requests **two** privileged gateway intents — `MessageContent` and
`GuildMembers`. Both must be enabled in the
[Discord Developer Portal](https://discord.com/developers/applications)
(your application → Bot → Privileged Gateway Intents) or Gateway login is
rejected.

> - **Message Content Intent** — without it the Gateway delivers messages with
>   an empty `content` string and the bot cannot read what users write.
> - **Server Members Intent** (`GuildMembers`) — backs member search, which
>   powers `lookup_discord_user` / `thread.lookupUser`. Without it those
>   lookups fail and login is rejected.

### Reaction intent and partials

The adapter also requests `GuildMessageReactions` and enables the
`Partials.Message` and `Partials.Reaction` partials:

> - **`GuildMessageReactions`** — a **non-privileged** gateway intent; no
>   toggle is needed in the Discord Developer Portal (unlike `MessageContent`
>   and `GuildMembers`). Required to receive reaction events in guild channels.
> - **`DirectMessageReactions`** — also non-privileged; required to receive
>   reaction events in DMs. Discord.js v14 treats guild and DM reactions as
>   separate intents — both are needed if the bot operates in DMs.
> - **`Partials.Message` + `Partials.Reaction`** — Discord only includes full
>   message objects in the reaction event payload when the message is already
>   in the client's in-memory cache. For any message that was sent before the
>   bot started (or was evicted from cache), the payload arrives as a _partial_.
>   Enabling these two partials lets the listener fetch the full object on
>   demand via `reaction.fetch()` / `reaction.message.fetch()`, so reactions
>   on older messages are not silently dropped.

## What it provides

### JSX → Components V2 rendering

`renderDiscordMessage(ir)` translates the `@copilotkit/channels-ui` vocabulary to a
ready-to-send Discord Components V2 payload (`{ components, flags }`) with the
`IS_COMPONENTS_V2` flag (`MessageFlags.IsComponentsV2`) set. It builds on
`renderComponents(ir)`, the lower-level building block, which returns a bare
`ContainerBuilder` with no flag. The entire message is wrapped in a single
`Container`; child nodes map as follows:

| bot-ui element         | Discord output                                          |
| ---------------------- | ------------------------------------------------------- |
| `Message`              | `Container` (accent color → `setAccentColor`)           |
| `Header`               | `TextDisplay` with `# ` prefix                          |
| `Section` / `Markdown` | `TextDisplay`                                           |
| `Fields`               | `TextDisplay` — each field as a **bold-label** line     |
| `Context`              | `TextDisplay` — each part as a `-# subtext` line        |
| `Actions`              | One or more `ActionRow`s                                |
| `Button`               | `Button` (custom_id = minted opaque `ck:` id)           |
| `Select`               | `StringSelect` (custom_id = minted opaque `ck:` id)     |
| `Image`                | `MediaGallery` with a single item                       |
| `Divider`              | `Separator`                                             |
| `Table`                | `TextDisplay` — fenced code block via `discordMarkdown` |

### Per-element budget

Discord caps every element. The renderer degrades by truncate-with-overflow /
clamp — it never silently drops content. Limits live in `DISCORD_LIMITS`:

| Limit                  | Value | Element                               |
| ---------------------- | ----- | ------------------------------------- |
| `componentsPerMessage` | 40    | total (nested) components per message |
| `actionRows`           | 5     | action rows per message               |
| `buttonsPerRow`        | 5     | buttons per action row                |
| `selectOptions`        | 25    | options per string select             |
| `textDisplayChars`     | 2000  | chars per TextDisplay                 |
| `buttonLabel`          | 80    | button label chars                    |
| `customId`             | 100   | `custom_id` chars                     |
| `headerText`           | 256   | header line chars (`# ` TextDisplay)  |

### Streaming

`thread.stream(...)` posts a plain-text placeholder and edits it in place via
`ChunkedMessageStream`: throttled `message.edit` calls at ~1100 ms intervals,
2000-char chunking, mid-stream bracket auto-close, and Markdown →
Discord-flavored Markdown translation so the in-flight message always renders.

### Interactions (ack-first)

Every `interactionCreate` event (button click, string select) is immediately
acknowledged with `deferUpdate` (within the **≤3s** deadline,
`ackDeadlineMs = 3000`). `decodeInteraction` then extracts the opaque minted
id (`ck:…`) from the `custom_id`, and hands an `InteractionEvent` to the
engine. The token carries only the opaque id — no props or secrets. Unrelated
clicks decode to events the bot harmlessly ignores.

### Human-in-the-loop

Use `thread.awaitChoice(<Picker .../>)` to post an interactive message and
block until a click resolves it; the resolved value is the clicked control's
value. Agent interrupts (`on_interrupt`) are captured by the run renderer and
dispatched to your `onInterrupt` handler, which posts a picker; the click
resumes the agent via `thread.resume(value)`.

### Modals

`openModal(view)` opens a Discord modal in response to a button click or slash
command. The call must happen **before any other response** (within Discord's
3-second acknowledgement window) — open the modal first, then do long-running
work in a follow-up message.

> **Validation re-open is not supported on Discord.** When a user submits a
> modal, a `bot.onModalSubmit` handler may return `{ errors }`, but Discord has
> no API to re-open the same modal with per-field validation errors (unlike
> Slack's `response_action: "errors"` mechanic). The `{ errors }` result is
> ignored by the adapter — the modal is acknowledged with `deferUpdate`
> regardless. Validate inputs before calling `openModal`, or post a follow-up
> message to report any submission errors.
>
> Only `TextInput` fields are supported in Discord modals. `ModalSelect` and
> `RadioButtons` elements are rejected at render time with a `ModalRenderError`
> (which `openModal` surfaces as `{ ok: false, error }`).

### Ephemeral messages

Discord ephemeral messages are interaction-scoped — Discord only supports them
as the initial response to a button click or slash command, and they cannot be
sent outside that 3-second window. For this reason `supportsEphemeral` is
advertised as `false`.

`thread.postEphemeral(user, ui, { fallbackToDM: true })` works around this by
sending the message as a **DM** to the target user when native ephemeral is
unavailable. The result carries `{ ok: true, usedFallback: true }` so callers
can detect that a DM was used instead of an in-channel ephemeral.

With `{ fallbackToDM: false }` and no live interaction, `postEphemeral` returns
`null` (the documented no-fallback sentinel).

> **Future enhancement:** native interaction-ephemeral follow-up (calling
> `interaction.followUp({ ephemeral: true, … })` within the ack window) is a
> planned addition. Once plumbed, `supportsEphemeral` will be upgraded to `true`
> for interaction contexts and `usedFallback` will return `false`.

### Typing indicator and reactions

The adapter supports both Discord-native capabilities:

- **Typing indicator** — `channel.sendTyping()` is called at the start of each
  run, giving users immediate feedback.
- **Reactions** — `supportsReactions: true` is advertised; the engine can add
  emoji reactions during processing.

### Sender-profile resolution

The adapter resolves each turn's Discord user id to a `PlatformUser`
(`{ id, name?, handle? }`), cached per id. Note that Discord bots cannot read
user email addresses — `PlatformUser.email` is always `undefined` on this
platform. Inbound file attachments can be downloaded and delivered to the agent
as multimodal content parts (`buildFileContentParts`); a tool can post a file
back out via `thread.postFile(...)`.

### Built-ins

- `defaultDiscordTools` — ships `lookup_discord_user` so the agent can resolve
  a name/handle to a `<@USERID>` mention. Spread into `tools`.
- `defaultDiscordContext` — tagging procedure, Discord Markdown formatting
  guidance, and the Discord channel/thread conversation model. Spread into
  `context`.

## Tool context

Tools receive the single shared `ChannelToolContext` from `@copilotkit/channels`
(`{ thread, message?, user?, signal?, platform }`) and reach Discord power
only through capability-gated `thread` methods, which this adapter backs:

- `thread.getMessages()` — the current channel's recent messages (via
  `channel.messages.fetch`), each a `ThreadMessage` (`{ user?, text, ts?,
isBot? }`).
- `thread.lookupUser(query)` — resolve a name/handle to a `PlatformUser` by
  searching guild members.
- `thread.postFile({ bytes, filename, title?, altText? })` — upload a file
  into the channel as an attachment.

This keeps tools portable: define them with `defineChannelTool({...})` and they
work against any adapter that advertises the same capabilities.

## Slash commands

Slash commands are registered up front — when the runtime activates the
channel (`await handler.channels.ready()`) — via `registerCommands`. When
`guildId` is set they register to that guild instantly; without it they
register globally and take ~1 hour to propagate. Register handlers with
`bot.onCommand`:

```ts
bot.onCommand({
  name: "triage",
  description: "Summarize the thread and propose issues.",
  options: {
    // Optional JSON Schema for native Discord slash-command options.
    // Generates typed Discord option descriptors via jsonSchemaToDiscordOptions.
  },
  async handler({ thread, text, user, rawOptions }) {
    await thread.runAgent({ prompt: `Triage: ${text}` });
  },
});
```

Unlike Slack, commands are registered programmatically — there is no manifest
file. Discord delivers native structured option values via `rawOptions` when the
command's `options` schema is provided; args also arrive flattened as free text
in `ctx.text`.

> **App setup** (OAuth scopes, bot permissions, invite URL) is done via the
> Discord Developer Portal and the OAuth2 invite flow. A complete wiring example
> lives in [`examples/slack`](../../examples/slack) — one bot app that runs
> Slack and/or Discord depending on which secrets you set.

## What's NOT in v1

- **Modal limitations** — text-input modals are supported (up to 5 fields).
  `ModalSelect` and `RadioButtons` elements are rejected at render time.
  Validation re-open (`response_action: "errors"`) is not supported — Discord
  has no API for it; submit errors should be posted as a follow-up message
  instead.
- OAuth / multi-guild install (single bot token only)
- Durable (Redis/DB) `ActionStore` — in-memory only; actions expire on restart
- Proactive posting (bot replies only to turns it's part of)
- Auto-sharding (single `Client` instance)
- Native interaction-ephemeral (`supportsEphemeral` is `false`; use
  `thread.postEphemeral(user, ui, { fallbackToDM: true })` for a DM-based
  workaround)

## Exports

`discord`, `DiscordAdapter`, `DiscordAdapterOptions`; `DiscordConversationStore`;
`attachDiscordListener`, `ListenerConfig`, `ClientLike`, `IncomingCommandRaw`;
`createRunRenderer`, `ChannelLike`; `decodeInteraction`; `conversationKeyOf`,
`ReplyTarget`, `IncomingTurn`; `renderComponents`, `renderDiscordMessage`,
`DISCORD_LIMITS`; `discordMarkdown`; `MessageStream`, `MessageStreamConfig`;
`ChunkedMessageStream`, `ChunkedMessageStreamConfig`; `autoCloseOpenMarkdown`;
`registerCommands`, `jsonSchemaToDiscordOptions`; `buildFileContentParts`,
`DiscordAttachmentRef`, `AgentContentPart`, `FileDeliveryConfig`;
`defaultDiscordContext`, `discordTaggingContext`, `discordFormattingContext`,
`discordConversationModelContext`; `lookupDiscordUserTool`, `defaultDiscordTools`.
