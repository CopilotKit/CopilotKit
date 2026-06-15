# @copilotkit/bot-discord

The **Discord `PlatformAdapter`** for [`@copilotkit/bot`](../bot). It connects a
Discord application to any AG-UI agent: ingress via discord.js (Gateway), egress
as Components V2 rendered from the `@copilotkit/bot-ui` JSX vocabulary, plus text
streaming, opaque-id interactions, and HITL.

You write your UI as JSX once (`@copilotkit/bot-ui`) and drive the bot with
`@copilotkit/bot`; this package is the only one that talks to Discord.

## Install

```sh
pnpm add @copilotkit/bot-discord @copilotkit/bot @copilotkit/bot-ui
```

## Quickstart

```ts
import { createBot } from "@copilotkit/bot";
import {
  discord,
  defaultDiscordTools,
  defaultDiscordContext,
} from "@copilotkit/bot-discord";

const bot = createBot({
  adapters: [
    discord({
      botToken: process.env.DISCORD_BOT_TOKEN!, // Bot token — Gateway + REST
      appId: process.env.DISCORD_APP_ID!,       // Application ID for command registration
      guildId: process.env.DISCORD_GUILD_ID,    // Optional: instant guild-scoped dev commands
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

await bot.start();
```

`discord(opts)` returns a `DiscordAdapter`. The adapter connects via the
Discord Gateway (WebSocket) — no public URL required. The listener pre-filters
ingress to the turns the bot should answer (@-mentions in guild channels,
replies in threads it owns, and DMs), so a single `onMention` handler covers
most use cases.

### Required env

| Var                   | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`   | Bot token for Gateway login and REST calls.                                |
| `DISCORD_APP_ID`      | Application ID used when registering slash commands.                       |
| `DISCORD_GUILD_ID`    | *(Optional)* Guild ID for instant per-guild command registration in dev.   |

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

## What it provides

### JSX → Components V2 rendering

`renderDiscordMessage(ir)` translates the `@copilotkit/bot-ui` vocabulary to a
ready-to-send Discord Components V2 payload (`{ components, flags }`) with the
`IS_COMPONENTS_V2` flag (`MessageFlags.IsComponentsV2`) set. It builds on
`renderComponents(ir)`, the lower-level building block, which returns a bare
`ContainerBuilder` with no flag. The entire message is wrapped in a single
`Container`; child nodes map as follows:

| bot-ui element         | Discord output                                          |
| ---------------------- | ------------------------------------------------------- |
| `Message`              | `Container` (accent color → `setAccentColor`)          |
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

| Limit                  | Value | Element                              |
| ---------------------- | ----- | ------------------------------------ |
| `componentsPerMessage` | 40    | total (nested) components per message |
| `actionRows`           | 5     | action rows per message              |
| `buttonsPerRow`        | 5     | buttons per action row               |
| `selectOptions`        | 25    | options per string select            |
| `textDisplayChars`     | 2000  | chars per TextDisplay                |
| `buttonLabel`          | 80    | button label chars                   |
| `customId`             | 100   | `custom_id` chars                    |
| `headerText`           | 256   | header line chars (`# ` TextDisplay) |

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

Tools receive the single shared `BotToolContext` from `@copilotkit/bot`
(`{ thread, message?, user?, signal?, platform }`) and reach Discord power
only through capability-gated `thread` methods, which this adapter backs:

- `thread.getMessages()` — the current channel's recent messages (via
  `channel.messages.fetch`), each a `ThreadMessage` (`{ user?, text, ts?,
  isBot? }`).
- `thread.lookupUser(query)` — resolve a name/handle to a `PlatformUser` by
  searching guild members.
- `thread.postFile({ bytes, filename, title?, altText? })` — upload a file
  into the channel as an attachment.

This keeps tools portable: define them with `defineBotTool({...})` and they
work against any adapter that advertises the same capabilities.

## Slash commands

Slash commands are registered up front on `bot.start()` via `registerCommands`.
When `guildId` is set they register to that guild instantly; without it they
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
> lives in [`examples/discord`](../../examples/discord).

## What's NOT in v1

- Modals / true batched form submit (`supportsModals: false`; `<Input>` is
  silently skipped with a console warning)
- OAuth / multi-guild install (single bot token only)
- Durable (Redis/DB) `ActionStore` — in-memory only; actions expire on restart
- Proactive posting (bot replies only to turns it's part of)
- Auto-sharding (single `Client` instance)

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
