# Architecture

How `@copilotkit/channels-github` is structured, and **why** each boundary
exists.

Application authors use this package with the product-facing
[`@copilotkit/channels`](../channels) umbrella. `GitHubAdapter` implements
[`PlatformAdapter`](../channels-core) from
[`@copilotkit/channels-core`](../channels-core). The channel engine owns the
platform-agnostic work: handlers, the run, tool, and interrupt loop, JSX action
binding, and the `ActionStore`. This package owns everything that is specific to
GitHub:

- Webhook ingress and signature checks.
- GitHub App and token auth.
- REST egress: comments, comment edits, review replies, reactions.
- Streaming through throttled comment edits.
- Numbered-choice interactions.
- History rebuilt from GitHub comments.

## Design goals

1. **The agent does not know about GitHub.** It receives ordinary AG-UI input
   and emits ordinary AG-UI events.
2. **GitHub mechanics stay out of the engine.** Signature checks, mention
   parsing, numbered choices, comment splitting, and history reads all live
   behind the `PlatformAdapter` interface.
3. **One file, one job.** Each source file has a single responsibility.
4. **Failures are contained.** A failed reaction or comment edit logs a
   warning. It does not stop the run. A failed final reply also makes
   `renderer.finish()` reject, so `thread.runAgent()` rejects.
5. **GitHub is the history.** Every comment is on GitHub already, so the adapter
   reads history from GitHub on every turn. It keeps no history store. The only
   adapter state is the open numbered-choice list (`stateStore`).

## The boundary: `PlatformAdapter`

```
GitHubAdapter (`@copilotkit/channels-github`)
  └── imports / implements ──► `@copilotkit/channels-core`: `PlatformAdapter`

`@copilotkit/channels` is the product-facing umbrella, not an adapter dependency.
```

The members `GitHubAdapter` implements (built with `github(opts)`):

- `platform` (`"github"`), `capabilities`, `ackDeadlineMs` (10000).
- `start(sink)` / `stop()`: begin and stop routing deliveries to the engine's
  `IngressSink`. When `port` is set, they also start and stop the built-in
  `GitHubWebhookServer`.
- `handleWebhook(request)`: the Web-standard handler that you mount in Hono,
  Next.js, or any `Request` host.
- `render(ir)`: IR to a Markdown body plus its numbered choices
  (`renderGitHubMessage`).
- `post` / `update` / `stream` / `delete`: egress through `GitHubApiClient`.
  `post` and `update` also refresh the open choice list of the conversation.
- `createRunRenderer(target)`: the AG-UI `RunRenderer` for one turn.
- `decodeInteraction(raw)`: always `undefined`. A numbered reply arrives as a
  comment webhook, so ingress decodes it.
- `lookupUser(query)`: always `undefined`.
- `getMessages(target)`: the comments of the conversation (backs
  `thread.getMessages`).
- `addReaction` / `removeReaction`: GitHub reactions (backs `thread.react` and
  `thread.unreact`).
- `conversationStore`: `GitHubConversationStore`, which reads history from
  GitHub.

## Request lifecycle

```
GitHub (App webhook or repository webhook)
  │  POST, signed with X-Hub-Signature-256
  ▼
createWebhookHandler (webhook.ts)
  • 405 not POST, 401 bad signature, 400 missing headers or bad JSON
  • awaits onEvent (prepare): 500 when it fails
  • 200, then runs the returned dispatch step in the background
  ▼
handleGitHubEvent (ingress.ts)
  prepare, before the response:
  • reads issue_comment / pull_request_review_comment, action "created"
  • skips comments by bot accounts and comments with the hidden marker
  • reads the open choice list, decodes the reply, consumes the list (last)
  dispatch, after the response:
  • open choice list + numbered reply ──► sink.onInteraction
  • mentions the bot                   ──► sink.onTurn
  • anything else                      ──► ignored (no dispatch step)
  ▼
@copilotkit/channels-core: Thread
  │  thread.runAgent()
  ▼
runAgentLoop
  ┌──────────────────────────────────────────────────────────────────────┐
  │ GitHubConversationStore rebuilds agent.messages from GitHub comments  │
  │ createRunRenderer:                                                    │
  │   • eyes reaction on the trigger comment at the first text message    │
  │   • TEXT_MESSAGE_* ──► create comment, then throttled edits (1/s)     │
  │   • past the soft limit ──► freeze the comment, continue in a new one │
  │   • captures frontend tool calls and interrupt custom events          │
  │   • RUN_ERROR ──► posts an agent error comment                        │
  └──────────────────────────────────────────────────────────────────────┘
  ▼
tool handlers / onInterrupt ──► thread.post(<JSX/>)
  ──► renderGitHubMessage ──► comment with a numbered list ──► stateStore
```

### Ingress

`createWebhookHandler` checks `X-Hub-Signature-256` with a timing-safe compare.
Then it awaits `onEvent`, which is the prepare phase. If `onEvent` fails, the
handler answers `500`. If it succeeds, the handler answers `200` and then runs
the dispatch function that `onEvent` returned, in the background. A `ping` gets
`200` and no dispatch. Errors in `onEvent` and in the dispatch go to
`console.error` with a `[channels-github]` prefix. They never become unhandled
rejections.

GitHub does not retry a failed delivery automatically. A `500` shows as a
failed delivery in **Recent Deliveries** of the webhook settings, and you can
redeliver it from there. A redelivery is not a duplicate for the engine: the
engine marks an event as seen in the sink, and a failed prepare never calls
the sink.

`handleGitHubEvent` is split in two phases. The prepare phase runs before the
response, inside the 10 s ack deadline of GitHub. It reads the payload, the
open choice list, and decodes a numbered reply. It consumes the list last, so
an earlier failure keeps the list for the redelivery. One case is not covered:
when a new list replaced the decoded one before the consume, prepare puts the
taken list back after the consume. If that read or write fails, the answer is
`500`, but the list is already gone, so a redelivery cannot restore it. The
dispatch phase runs after the response and calls `sink.onTurn` or
`sink.onInteraction`.

`handleGitHubEvent` reads only `issue_comment` and
`pull_request_review_comment` deliveries with action `created`. It builds the
`ReplyTarget`:

- `owner`, `repo`, and `issueNumber` from the payload.
- `installationId` from the payload in App mode.
- `reviewCommentId` for a review comment: the thread root (the parent of a
  reply, or the comment itself when it starts the thread).

The conversation key (`conversationKeyOf`) is
`github:<owner>/<repo>#<number>`, plus `/r<rootId>` for a review thread. So an
issue or PR conversation is one conversation, and each review thread is its own
conversation.

`stripBotMention` removes `@slug` and `@slug[bot]` mentions. A mention must
stand alone: `a@slug` and `@slug-two` do not match. A turn's `userText` is the
comment without the mention.

### Run and render

`thread.runAgent` gets the conversation's `AgentSession` from
`GitHubConversationStore`. The store reads the issue comments, or the review
thread comments, and maps them to AG-UI messages:

- One context message comes first. It holds the issue or PR title, URL, and
  description from `GET /issues/{number}`. In a review thread, it also holds
  the file, the line, and the last 60 lines of the root comment's diff hunk.
- Comments the adapter wrote become assistant messages. In App mode the
  posting login is `<slug>[bot]`, read once from `GET /app`.
- Other comments become user messages, with the bot mention removed.
- Only the newest 50 messages are kept.

### Own comments

The client adds a hidden HTML marker, `<!-- copilotkit-channels -->`, to every
comment it creates or edits (`bot-marker.ts`). Two checks use it:

- Ingress skips a comment by a bot account or with the marker. A person who
  copies the marker only hides their own comment.
- History treats a comment as the bot's when the posting login wrote it and it
  is a bot account or carries the marker. Other people cannot fake this,
  because they would have to post as the bot. In token mode the token owner
  is the posting login, so the owner can add the marker to a comment and make
  it an assistant message. Use token mode only for your own development.

So a personal access token of the same person who comments works: that
person's comments have no marker and stay user messages.

Each turn gets a fresh AG-UI `threadId`. GitHub does not hold internal tool
messages, so the agent never sees half of an earlier turn. The trigger comment is
already on GitHub, so the store seeds the inbound turn
(`seedsInboundTurn = true`).

`event-renderer.ts` streams each AG-UI text message into comments:

- The first text creates the comment. Later text edits it, at most once per
  second. A rate-limit error moves the next edit later.
- A failed edit logs a warning. If the final write of a text message fails,
  `finish()` rejects with that error after the log, so `thread.runAgent()`
  rejects. A later write that succeeds clears the failure.
- When the text passes the soft limit (65,536 minus 256 characters), the
  current comment is frozen and the text continues in a new comment. The cut
  goes after a newline, else after a space.
- When a cut falls inside a code fence, the frozen comment gets a closing fence
  and the next comment opens the fence again.

### Tools

When the agent calls a registered frontend tool, the loop validates the args
and calls `tool.handler(args, ctx)`. `ctx` is the shared `ChannelToolContext`.
There is no GitHub-specific context. A render tool calls `thread.post(<Card/>)`.
The engine binds the actions, and then `renderGitHubMessage` turns the IR into a
comment.

### HITL and interactions

GitHub has no interactive controls. The adapter uses a numbered list instead:

1. `renderGitHubMessage` lists each `Button` and `Select` option as a numbered
   line after `Reply with a number:`. It returns the list as `choices`.
2. `post` and `update` save the list in `stateStore` under the conversation key,
   for one hour (the `awaitChoice` default timeout).
3. A later comment in that conversation that is a listed number (`2`, `#2`,
   `2.`) or an option label (case ignored) becomes an interaction. It does not
   need a mention.
4. Ingress clears the list before it calls `sink.onInteraction`. When two replies
   race, only the first one wins.

The engine resolves the interaction: an `awaitChoice` waiter, or the
`ActionRegistry` handler for the minted action id. A control with a value and no
handler uses `VALUE_ONLY_CHOICE_ID`, so the value still reaches the waiter.

### Auth

`createTokenProvider` picks the mode from the options:

- **App mode** (`appId` + `privateKey`): `GitHubAppTokenProvider` signs an RS256
  App JWT with `node:crypto` and mints installation tokens. Tokens are cached
  per installation and refreshed 5 minutes before they expire.
- **Token mode** (`token`): `StaticTokenProvider` sends the same personal access
  token on every call. For local development.

## What differs from Slack

| Concern        | Slack                                               | GitHub                                                      |
| -------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Ingress        | Socket Mode (outbound WebSocket via Bolt)           | Signed HTTP webhook. Needs a public URL.                    |
| Trigger        | Mentions, DMs, and thread messages                  | Mentions only, plus a numbered reply to an open choice list |
| Egress         | `chat.update` streaming                             | Comment edits, at most one each second                      |
| History        | Reconstructed from `conversations.replies` per turn | Reconstructed from issue or review-thread comments per turn |
| Interactions   | Block Kit buttons and selects                       | A numbered list. A number or label reply answers it.        |
| Reactions      | Inbound and outbound                                | Outbound only. GitHub sends no reaction webhooks.           |
| Modals         | Supported                                           | Not supported                                               |
| User directory | `lookupUser` resolves names and emails              | `lookupUser` always returns `undefined`                     |

## SDK files at a glance

```
src/
├── index.ts               # public exports
├── adapter.ts             # github() factory + GitHubAdapter (PlatformAdapter impl)
├── types.ts               # GitHubAdapterOptions, ReplyTarget, GitHubMessageRef, webhook payload types
├── webhook.ts             # createWebhookHandler: signature check, status codes, prepare, background dispatch
├── webhook-server.ts      # GitHubWebhookServer: node:http wrapper for the built-in server (port)
├── ingress.ts             # handleGitHubEvent: prepare a comment delivery, dispatch to onTurn / onInteraction
├── interaction.ts         # conversationKeyOf, decodeChoiceReply, messageRefOf
├── pending-choices.ts     # open numbered-choice list per conversation, in stateStore
├── event-renderer.ts      # createRunRenderer: AG-UI subscriber → streamed, split comments + eyes reaction
├── render/
│   ├── message.ts         # renderGitHubMessage (IR → Markdown + numbered choices)
│   └── budget.ts          # GITHUB_LIMITS + truncateText
├── client.ts              # GitHubApiClient: comments, review replies, reactions, bot login
├── app-auth.ts            # App JWT + installation tokens, or a static token
├── conversation-store.ts  # GitHubConversationStore: GitHub comments → AgentSession
└── built-in-context.ts    # formatting + delivery context entries
```

## What is intentionally _not_ abstracted

- **No abstraction over the GitHub REST API.** If you use this package, you talk
  to GitHub (or GitHub Enterprise Server through `apiBaseUrl`).
- **No history store.** GitHub is the source of truth. A restart loses only the
  open choice lists when `stateStore` is in memory.
- **No GraphQL.** The adapter needs only the REST comment, review, and reaction
  endpoints.
