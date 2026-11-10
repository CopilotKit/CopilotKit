# @copilotkit/channels-notion

The **Notion `PlatformAdapter`** for [`@copilotkit/channels`](../channels). It puts
any AG-UI agent in Notion page comments. A person mentions the bot in a comment,
and the agent replies in the same discussion.

- Ingress: signed `comment.created` webhook events.
- Egress: comments, rendered from the `@copilotkit/channels-ui` JSX vocabulary.
- Streaming: the adapter edits one comment about once per second.
- Choices: buttons and selects render as a numbered list. A numbered reply picks one.

You write your UI as JSX once (`@copilotkit/channels-ui`) and drive the bot with
`@copilotkit/channels`. This package is the only one that talks to the Notion API.

The adapter keeps its own Notion credentials (`token` and `verificationToken`).
The Channel runs inside a `CopilotRuntime` with a CopilotKit Intelligence
connection, and the runtime starts and stops the Channel.

## Install

```sh
pnpm add @copilotkit/channels @copilotkit/channels-notion @copilotkit/runtime @ag-ui/client
```

The umbrella package also exports this adapter as `@copilotkit/channels/notion`.

## Quickstart

```ts
import { HttpAgent } from "@ag-ui/client";
import { createChannel } from "@copilotkit/channels";
import { notion, defaultNotionContext } from "@copilotkit/channels-notion";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

// Any AG-UI agent works. This one calls an AG-UI endpoint over HTTP.
const makeAgent = (threadId: string) =>
  new HttpAgent({ url: process.env.AGENT_URL!, threadId });

const bot = createChannel({
  identifyUser: "platform",
  name: "notion-bot", // project-unique Intelligence Channel name
  adapters: [
    notion({
      token: process.env.NOTION_TOKEN!,
      verificationToken: process.env.NOTION_VERIFICATION_TOKEN,
      port: 3000,
    }),
  ],
  agent: makeAgent,
  context: [...defaultNotionContext],
});

bot.onMessage(async ({ thread }) => {
  await thread.runAgent();
});

const runtime = new CopilotRuntime({
  intelligence: new CopilotKitIntelligence({
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY!,
  }),
  channels: [bot],
});

// Creating the listener starts the Channel and the webhook server on port 3000.
const listener = createCopilotNodeListener({ runtime });
await listener.channels.ready();
```

With `port` set, the adapter starts a `node:http` server:

- `POST /webhook` (option `path`) receives the Notion webhook.
- `GET /` answers `200 ok` as a health check.
- Every other path gets `404`.
- A request body over 1 MiB gets `413`.

Without `port`, no server starts. Mount `adapter.handleWebhook` in your own
framework. It takes a fetch `Request` and returns a `Response`:

```ts
const adapter = notion({ token, verificationToken });
app.post("/webhook", (c) => adapter.handleWebhook(c.req.raw)); // Hono
```

The handler drops events that arrive before the runtime starts the Channel.

### Required env

The adapter reads no environment variables. The examples use these names:

| Var                         | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `NOTION_TOKEN`              | Integration secret. Sent as `Authorization: Bearer <token>`. |
| `NOTION_VERIFICATION_TOKEN` | The `verification_token` that Notion sends to a new webhook. |

## Set up the Notion integration

1. Create an integration at https://www.notion.so/profile/integrations.
2. Give it these capabilities: **Read comments**, **Insert comments**, and
   **Read user information**. The adapter calls `GET /v1/users/me` to get the
   bot id and name.
3. Share each page that the bot must see with the integration.
4. Create a webhook subscription. Set the URL to your public webhook URL and
   select the `comment.created` event. The adapter ignores all other events.

### Webhook verification

Notion signs every event with the subscription's `verification_token`. Notion
sends this token one time, in an unsigned verification POST, when you create
the subscription.

1. Deploy without `verificationToken`, then create the subscription.
2. Read the token. It goes to `onVerificationToken`, or to the log when that
   callback is not set.
3. In the Notion webhook settings, click **Verify** and paste the token.
4. Set the token as `verificationToken` (for example in
   `NOTION_VERIFICATION_TOKEN`) and deploy again.

Until step 4, every signed event gets `401`. After step 4, the handler checks
`X-Notion-Signature` (HMAC-SHA256 of the raw body) on every POST and ignores
verification POSTs.

## When a comment becomes a turn

A `comment.created` event becomes a turn when the comment:

- mentions the bot user, or
- starts with the trigger text (default `@<bot name>`, option `trigger`), or
- is in a discussion that the bot replied in during the last 30 days.

The adapter removes the leading mention or trigger from the turn text. It
ignores the bot's own comments.

## Capabilities

| Capability               | Supported | Notes                                                              |
| ------------------------ | --------- | ------------------------------------------------------------------ |
| `supportsMessageEvents`  | true      | `comment.created` events.                                          |
| `supportsStreaming`      | true      | The adapter edits one comment, at most once per second.            |
| `supportsBlockingChoice` | true      | Numbered list. A reply of `2`, `#2`, `2.`, or the label picks one. |
| `supportsModals`         | false     | Notion has no modal surface.                                       |
| `supportsTyping`         | false     | Notion has no typing indicator.                                    |
| `supportsReactions`      | false     | The adapter does not add reactions.                                |
| `supportsEphemeral`      | false     | Every comment is visible to all page readers.                      |

`ackDeadlineMs` is 10000. The webhook handler answers `200` at once and routes
the event after the response.

## `NotionAdapterOptions` reference

| Option                | Type                                       | Default                    | Description                                                              |
| --------------------- | ------------------------------------------ | -------------------------- | ------------------------------------------------------------------------ |
| `token`               | `string`                                   | required                   | Integration secret.                                                      |
| `verificationToken`   | `string`                                   | `undefined`                | Key for the `X-Notion-Signature` check. Signed events need it.           |
| `onVerificationToken` | `(token: string) => void \| Promise<void>` | logs with `console.info`   | Receives the token from the one-time verification POST.                  |
| `trigger`             | `string`                                   | `"@<bot name>"`            | Text prefix that makes a comment a turn without a real mention.          |
| `port`                | `number`                                   | `undefined`                | Port for the built-in webhook server. No server starts when it is unset. |
| `path`                | `string`                                   | `"/webhook"`               | Webhook path for the built-in server.                                    |
| `stateStore`          | `StateStore`                               | `new MemoryStore()`        | Joined discussions and pending choices. Share it across instances.       |
| `interruptEventNames` | `ReadonlySet<string>`                      | `{"on_interrupt"}`         | Custom AG-UI event names that the run renderer treats as interrupts.     |
| `notionVersion`       | `string`                                   | `"2026-03-11"`             | Value of the `Notion-Version` request header.                            |
| `apiBaseUrl`          | `string`                                   | `"https://api.notion.com"` | Notion API origin. For tests.                                            |
| `fetch`               | `typeof fetch`                             | `globalThis.fetch`         | `fetch` for every Notion API call. For tests.                            |

## JSX to Notion rendering

`renderNotionMessage(ir)` lowers the `@copilotkit/channels-ui` IR to the
`rich_text` of one comment. Notion comments have no blocks, so every node
becomes a line:

| Node                  | Comment text                                 |
| --------------------- | -------------------------------------------- |
| `header`              | Bold line.                                   |
| `section`, `markdown` | Inline Markdown converted to annotations.    |
| `field`               | `label: value`, with a bold label.           |
| `table`               | One `a \| b` line per row.                   |
| `divider`, `context`  | `---`, and an italic line.                   |
| `image`               | A link.                                      |
| `button`, `select`    | One numbered list at the end of the comment. |

The list starts with `Reply with a number:` (`NOTION_CHOICE_PROMPT`). A link
button stays a link. When the comment is too long, the adapter cuts the prose,
never the list.

Inline Markdown that renders: `**bold**`, `*italic*`, `~~strikethrough~~`,
`` `code` ``, and `[label](https://url)` links. A heading becomes a bold line.
List markers stay as text. A fenced code block becomes code-styled text.

### Per-comment budget

Limits live in `NOTION_LIMITS`:

| Limit             | Value | Meaning                                             |
| ----------------- | ----- | --------------------------------------------------- |
| `richTextContent` | 2000  | Characters in one rich text item (Notion limit).    |
| `richTextItems`   | 100   | Rich text items in one comment (Notion limit).      |
| `commentText`     | 16000 | Adapter budget for the visible text of one comment. |

A streamed reply longer than `commentText` continues in a new comment.

## Persistence

### Adapter state (`stateStore`)

The adapter keeps two kinds of records:

- Joined discussions: the bot replied there, so later comments are turns.
  They expire after 30 days.
- Pending choices: the numbered list last posted in a discussion. They expire
  after one hour, the `awaitChoice` default.

The default is an in-process `MemoryStore`. If you run more than one instance,
pass a shared `StateStore`. Otherwise, a reply can reach an instance that does
not know the discussion.

A shared store does not cover `thread.awaitChoice`. It waits inside the process
that posted the list, so the reply must reach that same process. If you use
`awaitChoice`, run one instance.

### Conversation history

`NotionConversationStore` reads history from the discussion itself on every
turn:

- The bot's comments become assistant messages. Other comments become user
  messages.
- It reads up to 10000 comments of the page, and keeps the last 50 messages.
  If the page has more comments, `thread.runAgent()` throws and the agent does
  not reply.
- Notion lists only un-resolved comments, so a resolved discussion has no
  history.

### ActionStore (interaction rehydration)

The engine's `ActionStore` (from `@copilotkit/channels`) stores the action ids
behind `Button` and `Select` handlers. It is in memory by default. For handlers
that survive a restart, pass a durable `ActionStore` to
`createChannel({ actionStore })`.

## Built-ins

- `defaultNotionContext`: two context entries. Spread it into `context`.
- `notionFormattingContext`: tells the agent which inline Markdown renders.
- `notionDeliveryContext`: tells the agent that replies stream by editing one
  comment, and that choices are a numbered list.

## Tool context

Tools receive the shared `ChannelToolContext` from `@copilotkit/channels`. The
adapter backs these `thread` methods:

- `thread.getMessages()`: the discussion's un-resolved comments, oldest first.
- `thread.lookupUser(query)`: always returns `undefined`. The adapter does not
  search Notion users.

## Limits

- Resolved comments are not in history.
- History reads up to 10000 comments per page. The agent sees the last 50
  messages. On a page with more comments, the agent does not reply.
- Notion allows about 3 requests per second per integration. The adapter edits
  a streamed reply about once per second. A `429` with `Retry-After` of 5
  seconds or less is retried one time.
- No reactions, typing indicator, modals, ephemeral messages, or files.
- The public API cannot start a new inline discussion. The bot replies only in
  discussions that people start.

## Exports

- Adapter: `notion`, `NotionAdapter`, `NotionAdapterOptions`, `ReplyTarget`,
  `NotionMessageRef`, and the Notion object types (rich text, user, comment,
  webhook body).
- Webhook: `createWebhookHandler`, `WebhookHandlerOptions`,
  `NotionWebhookServer`, `NotionWebhookServerOptions`.
- API client: `NotionApiClient`, `NotionApiError`, `NotionApiClientOptions`.
- Rendering: `renderNotionMessage`, `RenderedChoice`, `NOTION_CHOICE_PROMPT`,
  `NOTION_VALUE_ONLY_ACTION_ID`, `NOTION_LIMITS`, `truncateText`,
  `markdownToRichText`, `plainTextToRichText`, `richTextToPlainText`.
- Engine parts: `defaultNotionContext`, `notionFormattingContext`,
  `notionDeliveryContext`, `conversationKeyOf`, `NotionConversationStore`,
  `NotionConversationStoreOptions`, `createRunRenderer`,
  `NotionRunRendererOptions`, `RunRendererTimers`.
