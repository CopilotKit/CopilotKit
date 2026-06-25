# Architecture

`@copilotkit/bot-teams` is a concrete `PlatformAdapter` for
[`@copilotkit/bot`](../bot): it plugs Microsoft Teams into the
platform-agnostic bot engine, exactly as [`@copilotkit/bot-slack`](../bot-slack)
does for Slack. You write the bot once (handlers, JSX, tools, context) and this
package translates between the engine and Teams via the **Microsoft 365 Agents
SDK** (`@microsoft/agents-hosting`).

## Design goals

- **The agent is ignorant of Teams.** Tool/handler code uses the engine's
  platform-agnostic surface (`thread.post`, `thread.stream`,
  `thread.awaitChoice`, bot-ui JSX). Nothing Teams-specific leaks up.
- **Teams mechanics are contained.** Adaptive Card rendering, streamed-by-edit
  updates, card-action decoding, and proactive auth all live behind the
  `PlatformAdapter` boundary.
- **Failure isolation.** One bad turn (e.g. a Bot Connector error) is logged and
  contained, so it never crashes the process or takes down other conversations.

## The boundary: `PlatformAdapter`

`TeamsAdapter` (in `adapter.ts`) implements the engine's `PlatformAdapter`:
ingress normalization, egress (`post` / `update` / `delete` / streamed edits),
IR→native rendering, capability flags, and the conversation store. `teams(opts)`
is the thin factory most callers use.

## Request lifecycle

```
Teams ──HTTP──▶ POST /api/messages (listener.ts, express)
              │   CloudAdapter.process  ── authenticates, builds TurnContext
              ▼
          handleActivity (adapter.ts)
              │   message?      → sink.onTurn(...)        → engine runs handlers / agent
              │   card submit?  → sink.onInteraction(...) → engine resolves awaitChoice
              ▼
          egress: render IR → Adaptive Card | Markdown text, sent on a
                  TurnContext (proactive when credentialed; see below)
```

### Ingress

`createTeamsServer` (`listener.ts`) stands up `POST /api/messages` (+ a
`/healthz` liveness probe) and hands each inbound activity to
`CloudAdapter.process`, which authenticates the request and invokes
`handleActivity`. The `process` promise is `.catch`-contained so a failed turn
returns 500 instead of crashing the process.

### Proactive vs in-turn (the credentialed split)

How the bot replies depends on whether it has Microsoft credentials:

- **Credentialed (real Teams):** ingress acks the inbound turn immediately and
  runs the work on a **detached `continueConversation` context** authenticated
  by the app id. This lets an `awaitChoice` suspend outlive the ~15s Teams turn
  window (an approval can land minutes later), and (critically) it is the
  _authenticated_ context. The inbound turn's own connector client is created
  with an **anonymous identity**, so using it for outbound calls
  (`sendActivity`/`updateActivity`) is rejected `401`. **Both** ordinary replies
  **and** card interactions therefore run on the proactive context.
- **Anonymous (local M365 Agents Playground):** `continueConversation` needs an
  app id we don't have, so work runs on the inbound turn context. localhost
  holds that connection open across an `awaitChoice` suspend, and the Playground
  doesn't enforce connector auth, so the anonymous context is fine there.

### Run / render

`createRunRenderer` (`event-renderer.ts`) subscribes to the agent's AG-UI event
stream and bridges it to Teams: each text message is **streamed by edit**. It posts
once (after a typing indicator), then `updateActivity` edits it as the buffer grows,
throttled and serialised by `TeamsMessageStream` (`message-stream.ts`). Mid-stream
buffers are balanced by `autoCloseOpenMarkdown` (`render/auto-close.ts`) so an
in-flight `**`/code-fence never renders broken; the finalized message commits the
agent's exact (balanced) text. Tool calls and interrupts are captured for the
run-loop to read after `runAgent` resolves.

### Rendering

`render(ir)` chooses the surface: a reply that collapses to plain text
(`isPlainText`) is sent as a normal **Markdown** text activity (a bare `Echo: hi`
shouldn't be a card); anything structured/interactive becomes an **Adaptive Card
1.5** attachment (`render/adaptive-card.ts`). Both renderers clamp to
`TEAMS_LIMITS` (`render/budget.ts`) to stay within Teams' payload ceilings.

### HITL & interrupts

A tool handler that calls `await thread.awaitChoice(<Card/>)` posts an approval
Adaptive Card and suspends the run. The card's buttons are `Action.Submit`s
carrying an opaque `ckActionId` + tiny value in their `data`. The click arrives
as a Message activity; `parseCardAction` / `decodeInteraction` (`interaction.ts`)
recognise it and route it to `sink.onInteraction`, which resolves the waiter and
runs the button's `onClick` (e.g. editing the card in place). Ingress and
interaction decoding derive the conversation key from one shared helper
(`conversationKeyOf`) so the waiter always resolves.

### Conversation store

Teams does not hand the bot a queryable transcript (unlike Slack's
`conversations.history`), so `TeamsConversationStore` (`conversation-store.ts`)
keeps an **in-memory** transcript per conversation and seeds each agent run with
it. It implements the engine's `ConversationStore` interface, so a durable
backend can be swapped in for production (today the store and any pending
`awaitChoice` waiters do not survive a restart).

## SDK files at a glance

| File                       | Role                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `adapter.ts`               | `PlatformAdapter`: ingress, egress, proactive auth, rendering        |
| `listener.ts`              | express server: `POST /api/messages` + `/healthz`, error containment |
| `event-renderer.ts`        | AG-UI → streamed-by-edit + tool/interrupt capture                    |
| `message-stream.ts`        | throttled, serialised post-then-edit state machine                   |
| `render/adaptive-card.ts`  | bot-ui IR → Adaptive Card 1.5 (+ HITL action ids)                    |
| `render/markdown.ts`       | bot-ui IR → Markdown (plain-text path)                               |
| `render/auto-close.ts`     | balances mid-stream markdown for clean edits                         |
| `render/budget.ts`         | per-element limits, truncation/clamping                              |
| `interaction.ts`           | decode `Action.Submit` → engine `InteractionEvent`                   |
| `conversation-store.ts`    | in-memory transcript (pluggable for durability)                      |
| `sanitizing-http-agent.ts` | `HttpAgent` tolerant of `@ag-ui/langgraph` event quirks              |

## What's intentionally _not_ done yet

The architecture leaves room for each; none is required for the core loop:

- **Native token streaming:** replies stream by post-then-edit, not via the
  SDK's `StreamingResponse` (`queueTextChunk`/`endStream`).
- **Durable conversation store + HITL waiters:** in-memory today.
- **File upload/download** and **Microsoft Graph user lookup:** not wired.

These mirror the deferred items in the README's roadmap.
