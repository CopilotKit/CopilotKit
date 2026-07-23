# @copilotkit/channels-teams

The **Microsoft Teams platform adapter** for [`@copilotkit/channels`](../channels). It's a
concrete `PlatformAdapter` that plugs Teams into the platform-agnostic bot
engine, exactly like [`@copilotkit/channels-slack`](../channels-slack) does for Slack. You
write your bot once with `createChannel` (handlers, JSX, tools, context) and run it
on Teams by adding this adapter.

It is built on the **Microsoft 365 Agents SDK** (`@microsoft/agents-hosting`),
the successor to the Bot Framework SDK.

The adapter keeps its own Teams/Microsoft 365 credentials (`clientId` /
`clientSecret` / `tenantId`, or none for anonymous local dev) — but the
Channel itself only runs inside a CopilotKit Intelligence-configured
`CopilotRuntime` (an API key; a free tier is available). There is no
standalone / DIY runner and no `channel.start()`; the runtime starts and owns
the channel because Intelligence is configured.

## Install

```sh
pnpm add @copilotkit/channels @copilotkit/channels-ui @copilotkit/channels-teams
```

## Quickstart

```ts
import { createChannel } from "@copilotkit/channels";
import { teams } from "@copilotkit/channels-teams";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const bot = createChannel({
  name: "support-bot", // project-unique Intelligence Channel name
  adapters: [teams({ port: 3978 })],
});

bot.onMessage(({ thread, message }) => thread.post(`Echo: ${message.text}`));

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
await handler.channels.ready(); // POST /api/messages now listening on :3978
```

Then point the **Microsoft 365 Agents Playground** at it. No Microsoft
credentials are required for local development:

```sh
npx @microsoft/m365agentsplayground   # opens http://localhost:56150
```

The Playground connects to `http://127.0.0.1:3978/api/messages` and gives you a
Teams-like chat UI to test against. See [`examples/teams`](../../examples/teams)
for a complete, runnable echo bot, and the
[Microsoft Teams guide](../../showcase/shell-docs/src/content/docs/frontends/teams.mdx)
for sideloading into real Teams via Azure Bot Service.

## How it maps onto the `PlatformAdapter` contract

- **Ingress:** a `CloudAdapter` receives Teams activities at
  `POST /api/messages` (stood up by an Express server). Each `message` activity
  is normalized into `sink.onTurn(...)`. Uploaded files ride along as
  attachments: `buildFileContentParts` downloads them (a `file.download.info`
  URL, or a `data:`/https media URL) and hands the agent multimodal content
  parts — CSV/JSON/text as decoded text, images and PDFs as binary. That's what
  makes "upload a CSV → get a chart" work. Note Teams only delivers uploaded
  files to a bot in **1:1 (personal) chat** (requires `supportsFiles: true` in
  the app manifest); in a channel or group chat Teams does NOT send the file to
  the bot at all, so chart-from-data there means pasting the data inline.
- **Egress:** structured/interactive UI is rendered to an **Adaptive Card**
  (1.5) and sent as an attachment; a reply that collapses to plain text is sent
  as a normal text activity (a bare `Echo: hi` shouldn't be a card). Both go out
  on the live `TurnContext` _within the originating turn_. The engine awaits the
  whole turn handler, so a reply (or a full `runAgent()` loop) completes before
  the HTTP response closes. (Out-of-turn / proactive sends fall back to
  `CloudAdapter.continueConversation` via the captured conversation reference.)
- **Files out:** `postFile` posts a file to the conversation. An image (e.g. a
  rendered chart PNG) is sent as an inline attachment via a `data:` URI, so it
  renders directly in the thread — the bot-slack `postFile` parallel.
- **Streaming:** text replies stream **by message edit** (Teams' baseline
  model). It posts the first content, then `updateActivity` edits the same
  message as the buffer grows (throttled and serialised; see
  `TeamsMessageStream`), after a typing indicator. Native token streaming is a
  later enhancement.
- **Agent runs:** `createRunRenderer` bridges AG-UI events to Teams. Each text
  message is streamed by edit, and tool calls plus interrupts are captured for
  the run loop.
- **History:** Teams does not hand the bot a queryable transcript, so an
  in-memory `TeamsConversationStore` keeps one per conversation and seeds each
  agent run with it. Swap in a durable `ConversationStore` for production.

## Options

```ts
teams({
  port: 3978, // POST /api/messages port (Playground default)
  clientId, // Microsoft app id; omit for anonymous local dev
  clientSecret, // omit for anonymous local dev
  tenantId, // omit for multi-tenant / anonymous
  interruptEventNames, // custom-event names treated as agent interrupts
});
```

Credentials also resolve from the `clientId` / `clientSecret` / `tenantId`
environment variables (the names the M365 Agents SDK reads).

## Status & roadmap

Implemented: message ingress; **Adaptive Card rendering** of the bot-ui
vocabulary (`<Header>`, `<Section>`/`<Markdown>`, `<Fields>`, `<Table>`,
`<Image>`, `<Actions>`/`<Button>`, `<Select>`, `<Input>`, `<Context>`) with a
plain-text path for bare replies and a Markdown table fallback; **streamed-by-
edit** text replies with a typing indicator; `runAgent` tool-call / interrupt
capture; **card-action round-trip + HITL** (below); conversation history;
`update` / `delete`. Verified in the M365 Agents Playground.

**Card-action round-trip + HITL.** Adaptive Card `Action.Submit` clicks arrive
as Message activities carrying the action `data` in `activity.value`;
`decodeInteraction` parses our opaque `ckActionId` + button value and routes them
to `sink.onInteraction`, which resolves the engine's `awaitChoice` waiter and
runs the button's `onClick` (e.g. to edit the picker in place). A tool handler
that calls `await thread.awaitChoice(<Card/>)` therefore gates the agent on a
human decision; see `examples/teams` for an approve/reject demo. Ingress and
interaction decoding derive the conversation key from one shared helper
(`conversationKeyOf`) so the waiter always resolves.

**Async turn handoff.** When credentialed, ingress acks the inbound turn
immediately and runs the agent on a detached `continueConversation` context, so
an `awaitChoice` suspend can outlive the Teams turn window (approval minutes
later). In the anonymous local Playground (where `continueConversation` has no
app id) the run uses the inbound turn context, which localhost holds open across
the suspend. Waiters are in-memory (v1), so they don't survive a process restart.

Planned follow-ups (the architecture leaves room for each):

- **Native token streaming:** token-by-token replies via the SDK's
  `StreamingResponse` (`queueInformativeUpdate` / `queueTextChunk` / `endStream`),
  vs. the current post-then-edit model.
- **Durable HITL waiters:** persist pending `awaitChoice` state so approvals
  survive a restart (today they're in-memory).
- **User lookup** (Microsoft Graph) and **arbitrary non-image file upload** via
  the Teams/Graph file-consent flow (today `postFile` handles inline images).

## Exports

`teams`, `TeamsAdapter`, `TeamsAdapterOptions`, `TeamsReplyTarget`,
`ConversationKey`; `TeamsConversationStore`; `createRunRenderer`;
`conversationKeyOf` / `parseCardAction`; `renderTeamsMarkdown`;
`renderAdaptiveCard` / `AdaptiveCard` / `isPlainText` /
`ADAPTIVE_CARD_CONTENT_TYPE`; `TEAMS_LIMITS`; `TeamsMessageStream`;
`createTeamsServer` / `TeamsServer` / `TeamsServerConfig`;
`SanitizingHttpAgent`; `buildFileContentParts` / `TeamsAttachmentRef` /
`FileDeliveryConfig`.
