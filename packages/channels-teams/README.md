# @copilotkit/channels-teams

The **Microsoft Teams platform adapter** for [`@copilotkit/channels`](../channels). It's a
concrete `PlatformAdapter` that plugs Teams into the platform-agnostic bot
engine, exactly like [`@copilotkit/channels-slack`](../channels-slack) does for Slack. You
write your bot once with `createChannel` (handlers, JSX, tools, context) and run it
on Teams by adding this adapter.

It is built on the **Microsoft 365 Agents SDK** (`@microsoft/agents-hosting`),
the successor to the Bot Framework SDK.

> **Beta / breaking change.** As of this release the `teams()` adapter is
> **declarative and credential-free**: it no longer takes `clientId` /
> `clientSecret` / `tenantId` and Channels are no longer started directly.
> Credentials and connectivity are supplied by CopilotKit Intelligence (the
> recommended path) or a custom `ChannelRunner`. See the quick start below.
> (Old: `teams({ clientId, clientSecret, tenantId })` + `channel.start()`; New:
> `teams()` + `new CopilotRuntime({ intelligence, channels })`.)

## Install

```sh
pnpm add @copilotkit/channels @copilotkit/channels-ui @copilotkit/channels-teams
```

## Quickstart

```ts
import { createChannel } from "@copilotkit/channels";
import { teams } from "@copilotkit/channels-teams";
import { CopilotRuntime } from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const support = createChannel({
  name: "support",
  agent: new HttpAgent({ url: process.env.AGENT_URL! }), // or "billing" | router | omitted→"default"
  adapters: [teams()], // credential-free
});

support.onMessage(({ thread, message }) =>
  thread.post(`Echo: ${message.text}`),
);

// CopilotKit Intelligence supplies credentials, connectivity, delivery, and failover:
const runtime = new CopilotRuntime({
  intelligence,
  identifyUser,
  channels: [support],
});
```

`teams()` returns a `TeamsAdapter` — it holds no credentials. The
`POST /api/messages` listener, the Microsoft app id/secret/tenant, and
proactive re-entry are all supplied by the runner: CopilotKit Intelligence, or
a custom `ChannelRunner`. Running Channels without CopilotKit Intelligence
requires implementing a custom `ChannelRunner` (an advanced,
exported-but-undocumented escape hatch that supplies its own connectivity,
credentials, delivery, and failover).

For local testing against the **Microsoft 365 Agents Playground** (no
Microsoft credentials required) and sideloading into real Teams via Azure Bot
Service, see the runnable demo in
[`examples/teams`](../../examples/teams) and the
[Microsoft Teams guide](../../showcase/shell-docs/src/content/docs/frontends/teams.mdx).

## How it maps onto the `PlatformAdapter` contract

- **Ingress:** the runner-injected connector's `CloudAdapter` receives Teams
  activities at `POST /api/messages` (stood up by an Express server owned by
  the connector, not the adapter). Each `message` activity is normalized into
  `sink.onTurn(...)`. Uploaded files ride along as
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

`teams()` is credential-free — `TeamsAdapterOptions` only covers rendering/
run-loop behavior:

```ts
teams({
  interruptEventNames, // custom-event names treated as agent interrupts
  files, // tunables for inbound file size/count caps
});
```

### Credentials

The Microsoft app id/secret/tenant (`clientId` / `clientSecret` / `tenantId` —
the names the M365 Agents SDK reads), the `POST /api/messages` port, and
proactive re-entry now live on the connector, not on `teams()`. Configure them
on the Teams connector in CopilotKit Intelligence. Omitting them (anonymous
local dev against the Playground) is still supported at the connector level.

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

**Async turn handoff.** When the bound connector is credentialed, ingress acks
the inbound turn immediately and runs the agent on a detached
`continueConversation` context, so an `awaitChoice` suspend can outlive the
Teams turn window (approval minutes later). In the anonymous local Playground
(where `continueConversation` has no app id) the run uses the inbound turn
context, which localhost holds open across the suspend. Waiters are in-memory
(v1), so they don't survive a process restart.

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
