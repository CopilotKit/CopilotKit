# Architecture

How `@copilotkit/channels-notion` is structured and **why** each boundary exists.

Application authors use this package with the product-facing
[`@copilotkit/channels`](../channels) umbrella. `NotionAdapter` implements
[`PlatformAdapter`](../channels-core) from
[`@copilotkit/channels-core`](../channels-core).

- The channel engine owns the platform-agnostic work: handlers, the
  run/tool/interrupt loop, JSX action binding, and the `ActionStore`.
- This package owns everything Notion-specific: webhook ingress, comment
  egress, streaming by comment edits, numbered choices, and history from the
  discussion.

## Design goals

1. **The agent does not know about Notion.** It receives ordinary AG-UI input
   and emits ordinary AG-UI events.
2. **Notion mechanics stay behind `PlatformAdapter`.** Signature checks, comment
   fetches, rich text conversion, and numbered-reply decoding all live in this
   package.
3. **One file, one job.** Each source file has a single responsibility.
4. **Failures are contained.** The run renderer logs a failed Notion call and
   does not throw it into the run.
5. **History comes from Notion.** The discussion is the source of truth. The
   adapter keeps no transcript of its own.
6. **The framework is your choice.** `handleWebhook` is a fetch-style
   `(Request) => Promise<Response>` handler. The built-in `node:http` server is
   optional.

## The boundary: `PlatformAdapter`

`NotionAdapter` (made by `notion(opts)`) implements these members:

- `platform` (`"notion"`), `capabilities`, and `ackDeadlineMs` (10000).
  Streaming and blocking choice are `true`. Modals, typing, reactions, and
  ephemeral messages are `false`.
- `start(sink)` / `stop()`: keep the engine's `IngressSink`, and start or stop
  the `NotionWebhookServer` when `port` is set.
- `handleWebhook(request)`: the fetch-style webhook handler. Events that arrive
  before `start` are dropped.
- `render(ir)`: IR to comment `rich_text` plus numbered choices
  (`renderNotionMessage`).
- `post` / `update` / `delete`: create, edit, or delete a comment, and keep the
  discussion's pending choices in step.
- `stream(target, chunks)`: create one comment, then edit it at most once per
  second.
- `createRunRenderer(target)`: the AG-UI `RunRenderer` for a run.
- `decodeInteraction(raw)`: always `undefined`. Ingress decodes numbered
  replies and calls `sink.onInteraction` itself.
- `lookupUser(query)`: always `undefined`.
- `getMessages(target)`: the discussion's un-resolved comments (backs
  `thread.getMessages`).
- `conversationStore`: `NotionConversationStore`, backed by the discussion.

## Request lifecycle

1. Notion POSTs to the webhook URL. `createWebhookHandler` (`webhook.ts`)
   checks `X-Notion-Signature` against `verificationToken`, answers `200`, and
   runs `onEvent` after the response.
2. `handleNotionEvent` (`ingress.ts`) keeps only `comment.created` events that
   another user wrote. Events carry only the comment id, so it fetches the
   comment for its text and `discussion_id`.
3. If the discussion has pending choices and the reply picks one, ingress
   calls `sink.onInteraction` and clears the choices.
4. Otherwise, if the comment is addressed to the bot, ingress calls
   `sink.onTurn` with the conversation key `notion:<discussionId>`.
5. `thread.runAgent()` builds the agent with history from
   `NotionConversationStore`, then runs it with `createRunRenderer(target)`.
6. The renderer streams each AG-UI text message into a comment in the same
   discussion. The first reply marks the discussion as joined.

### Webhook verification

Notion sends the `verification_token` one time, in an unsigned POST, when a
subscription is created.

- While `verificationToken` is not set, the handler passes the token to
  `onVerificationToken` (or logs it) and answers `401` to every signed event.
- After `verificationToken` is set, the handler ignores verification POSTs.
  They are unsigned, so a forged one must not be able to hand the operator a
  token.

### Ingress: when a comment is a turn

A comment is a turn when one of these is true:

- It mentions the bot user.
- Its text starts with the trigger (default `@<bot name>`, from
  `GET /v1/users/me`).
- It is in a joined discussion: the bot replied there in the last 30 days.

The leading mention or trigger is removed from `userText`. The conversation
store removes it from history too, so both show the same words.

### Run and render

`event-renderer.ts` subscribes to AG-UI events:

- The first `TEXT_MESSAGE_CONTENT` delta creates a comment.
- Later deltas edit it at most once per `throttleMs` (default 1000). Notion
  allows about 3 requests per second per integration.
- `TEXT_MESSAGE_END` writes the final text.
- A message longer than `NOTION_LIMITS.commentText` continues in a new
  comment.
- `RUN_ERROR` posts an error comment.

All Notion calls run one at a time, in order. Errors are logged with a
`[channels-notion]` prefix.

### Tools

When the agent calls a registered frontend tool, the loop checks the args and
calls `tool.handler(args, ctx)`. `ctx` is the shared `ChannelToolContext`.
There is no Notion-specific context. A render tool posts JSX with
`thread.post(...)`, which goes through action binding, then
`renderNotionMessage`, then the comments API.

### HITL, interrupts, and interactions

Notion comments have no buttons. `renderNotionMessage` collects every `button`
and `select` option into one numbered list at the end of the comment.

- `post` and `update` save the list as the discussion's pending choices, with
  a one-hour TTL (the `awaitChoice` default). A newer list replaces the older
  one.
- A reply of `2`, `#2`, `2.`, or the option label (any case) picks a choice.
  Ingress turns it into an `InteractionEvent` with the minted action id and
  the option value.
- The engine resolves the interaction: an `awaitChoice` waiter, or
  `ActionRegistry.dispatch`.
- A button with only a `value` uses `NOTION_VALUE_ONLY_ACTION_ID`, so a
  numbered reply still resolves the waiter with that value.

`conversationKeyOf` is the one helper that builds the conversation key.
Ingress, interaction decoding, and the run renderer all use it, or
`awaitChoice` waiters never resolve.

### Adapter state

`conversation-state.ts` keeps joined discussions (30-day TTL) and pending
choices in the `stateStore` option. This store is not the engine's
`stateStore`. The default is an in-process `MemoryStore`, so multi-instance
deployments must pass a shared store.

## What differs from Slack

| Concern        | Slack                             | Notion                                                |
| -------------- | --------------------------------- | ----------------------------------------------------- |
| Ingress        | Socket Mode or signed HTTP        | Signed webhook. Needs a public URL                    |
| Address        | `@mention` in a channel or thread | Mention, trigger text, or a joined discussion         |
| Egress         | Block Kit messages                | Comment `rich_text`; inline Markdown only             |
| Streaming      | `chat.update` edits               | Comment edits, at most once per second                |
| Choices        | Native buttons and selects        | Numbered list; numbered or label reply                |
| History        | `conversations.replies`           | Un-resolved discussion comments; last 50 messages     |
| New threads    | The bot can start a thread        | The bot replies only in discussions that people start |
| User directory | `lookupUser` resolves names       | `lookupUser` always returns `undefined`               |

## SDK files at a glance

```
src/
├── index.ts                  # public exports
├── adapter.ts                # notion() factory + NotionAdapter (PlatformAdapter impl)
├── types.ts                  # NotionAdapterOptions, ReplyTarget, NotionMessageRef, Notion API types
├── webhook.ts                # createWebhookHandler: verification POST + signature check
├── webhook-server.ts         # NotionWebhookServer: optional node:http server for the handler
├── ingress.ts                # handleNotionEvent: comment.created -> onTurn / onInteraction
├── interaction.ts            # conversationKeyOf + numbered-reply decoding
├── conversation-state.ts     # joined discussions + pending choices in the StateStore
├── conversation-store.ts     # NotionConversationStore: discussion comments -> agent.messages
├── event-renderer.ts         # createRunRenderer: AG-UI events -> streamed comments
├── client.ts                 # NotionApiClient: comments, bot user, 429 retry
├── built-in-context.ts       # formatting + delivery context entries
└── render/
    ├── message.ts            # renderNotionMessage (IR -> rich_text + choices)
    ├── rich-text.ts          # Markdown <-> rich_text conversion
    └── budget.ts             # NOTION_LIMITS + truncateText
```

## What is intentionally _not_ abstracted

- **No abstraction over the Notion API.** If you use this package, you talk to
  the Notion public API, with a pinned `Notion-Version` header.
- **No new discussions.** The public API cannot start a new inline discussion,
  so the bot replies only in existing ones.
- **No transcript store.** History is read from the discussion on every turn.
  Resolved comments are not listed, so they are not in history.
