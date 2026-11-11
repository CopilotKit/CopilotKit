# @copilotkit/channels-github

The **GitHub `PlatformAdapter`** for [`@copilotkit/channels`](../channels). It
connects a GitHub App to any AG-UI agent. A person mentions the bot in an issue,
a pull request, or a pull request review thread, and the agent replies in that
same place.

- Ingress: signed GitHub webhooks (`issue_comment`, `pull_request_review_comment`).
- Egress: GitHub-flavored Markdown comments, rendered from the
  `@copilotkit/channels-ui` JSX vocabulary.
- Interactions: buttons and selects become a numbered list. A numbered reply
  answers it, so `thread.awaitChoice` and button handlers work.

You write your UI as JSX once (`@copilotkit/channels-ui`) and drive the bot with
`@copilotkit/channels`. This package is the only one that talks to the GitHub
REST API.

The adapter keeps its own GitHub credentials. The Channel still runs inside a
`CopilotRuntime` with a CopilotKit Intelligence connection, and the runtime
starts and stops the Channel.

For the full setup walkthrough (create the GitHub App, permissions, events,
install), read the
[GitHub guide](https://docs.copilotkit.ai/channels/github).

## Install

```sh
pnpm add @copilotkit/channels @copilotkit/channels-github
```

The umbrella package also re-exports this adapter from
`@copilotkit/channels/github`.

## Quickstart

```ts
import { createChannel } from "@copilotkit/channels";
import { github, defaultGitHubContext } from "@copilotkit/channels-github";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { makeAgent } from "./agent.js"; // your agent factory

const bot = createChannel({
  identifyUser: "platform",
  name: "github-bot", // project-unique Intelligence Channel name
  adapters: [
    github({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_PRIVATE_KEY!,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
      botUsername: "my-app", // the App slug, without @
      port: 3000, // built-in webhook server on POST /webhook
    }),
  ],
  agent: makeAgent,
  context: [...defaultGitHubContext],
});

// Every turn on GitHub is a mention of the bot.
bot.onMention(async ({ thread }) => {
  await thread.runAgent();
});

const runtime = new CopilotRuntime({
  agents: {},
  intelligence: new CopilotKitIntelligence({
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY!,
  }),
  channels: [bot],
});

// Creating the listener starts the Channel.
const listener = createCopilotNodeListener({ runtime });
await listener.channels.ready();
```

`github(opts)` returns a `GitHubAdapter`. The adapter does not add
`defaultGitHubContext` by itself. Spread it into `context` as shown.

### Mount the webhook in your own server

When you omit `port`, no server starts. Mount `adapter.handleWebhook` in any
framework that speaks `Request` and `Response`:

```ts
const adapter = github({
  /* ... no port ... */
});

app.post("/github/webhook", (c) => adapter.handleWebhook(c.req.raw));
```

`handleWebhook(request)` returns a `Response`:

| Status | When                                                                 |
| ------ | -------------------------------------------------------------------- |
| `200`  | A `ping`, or an accepted delivery. The agent runs in the background. |
| `400`  | `X-GitHub-Event` or `X-GitHub-Delivery` is missing, or bad JSON.     |
| `401`  | `X-Hub-Signature-256` is missing or wrong.                           |
| `405`  | The method is not `POST`.                                            |
| `500`  | The adapter cannot read the delivery's state from `stateStore`.      |

Before it answers, the adapter reads the open choice list of the conversation.
If this read fails, the adapter logs the error and answers `500`. GitHub does
not retry a failed delivery automatically. The delivery shows as failed in
**Recent Deliveries** of the webhook settings, and you can redeliver it there.

The adapter drops deliveries that arrive before the runtime starts the Channel.
Run it on a long-running host. A serverless function can freeze before the
background work ends.

### Required env

The package reads no environment variables. The examples use these names:

| Var                     | Purpose                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `GITHUB_APP_ID`         | The GitHub App id, from the App settings page.             |
| `GITHUB_PRIVATE_KEY`    | The App private key (PEM), generated on the settings page. |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret set on the App, for signature checks.   |

For local development, you can pass `token` (a personal access token) instead
of `appId` and `privateKey`.

## GitHub App setup

1. Create a GitHub App. Set the webhook URL and the webhook secret.
2. Give it these repository permissions: Issues (read and write), Pull requests
   (read and write), Metadata (read).
3. Subscribe to these events: Issue comment, Pull request review comment.
4. Generate a private key.
5. Install the App on the repositories that the bot serves.

## Capabilities

| Capability               | Supported | Notes                                                              |
| ------------------------ | --------- | ------------------------------------------------------------------ |
| `supportsMessageEvents`  | true      | Comments that mention the bot become turns.                        |
| `supportsStreaming`      | true      | Throttled comment edits, at most one edit each second.             |
| `supportsTyping`         | true      | An `eyes` reaction on the trigger comment while the agent writes.  |
| `supportsReactions`      | true      | Egress only. GitHub sends no reaction webhooks.                    |
| `supportsBlockingChoice` | true      | A numbered list. A numbered reply answers it.                      |
| `supportsModals`         | false     | GitHub has no modal surface.                                       |
| `supportsEphemeral`      | false     | Every GitHub comment is visible to all readers of the issue or PR. |

A reply longer than 65,536 characters continues in a new comment. When the
split falls inside a code block, the adapter closes the block and opens it again
in the next comment.

`thread.react` accepts the GitHub reaction names (`+1`, `-1`, `laugh`,
`confused`, `heart`, `hooray`, `rocket`, `eyes`) and the channel emoji that map
to them (`thumbs_up`, `thumbs_down`, `laugh`, `smile`, `heart`, `tada`,
`rocket`, `eyes`). Other emoji return `{ ok: false }`.

## `GitHubAdapterOptions` reference

Pass `appId` and `privateKey`, or pass `token`. Not both.

| Option                | Type                  | Default                    | Description                                                                  |
| --------------------- | --------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `appId`               | `string \| number`    | required in App mode       | GitHub App id.                                                               |
| `privateKey`          | `string`              | required in App mode       | GitHub App private key, PEM encoded.                                         |
| `token`               | `string`              | required in token mode     | Personal access token (classic or fine-grained), for local development.      |
| `webhookSecret`       | `string`              | required                   | Secret that signs the webhooks (`X-Hub-Signature-256`).                      |
| `botUsername`         | `string`              | required                   | The name users mention, without `@`: the App slug, or a login in token mode. |
| `port`                | `number`              | no server                  | Port for the built-in `node:http` webhook server.                            |
| `path`                | `string`              | `"/webhook"`               | Webhook path for the built-in server.                                        |
| `apiBaseUrl`          | `string`              | `"https://api.github.com"` | GitHub REST API base URL. Set it for GitHub Enterprise Server.               |
| `fetch`               | `typeof fetch`        | `globalThis.fetch`         | `fetch` for GitHub API calls.                                                |
| `stateStore`          | `StateStore`          | `new MemoryStore()`        | Adapter state (open numbered choices). Use a shared store for 2+ instances.  |
| `interruptEventNames` | `ReadonlySet<string>` | `{"on_interrupt"}`         | Custom AG-UI event names that the run renderer treats as interrupts.         |

## JSX to GitHub rendering

`renderGitHubMessage(ir)` lowers the `@copilotkit/channels-ui` IR to one
GitHub-flavored Markdown comment body:

- `Header` becomes a `###` heading.
- `Fields` becomes a bullet list. `Table` becomes a GFM table.
- `Divider` becomes `---`. `Context` becomes `<sub>` text. `Image` becomes `![alt](url)`.
- `Button` and `Select` options become one numbered list at the end, after the
  line `Reply with a number:`.
- `Input` and raw provider payloads render nothing.

When the body is too long, the adapter truncates the prose and keeps the
numbered list whole. `GITHUB_LIMITS.commentBody` is 65,536 characters.

## Choices and interactions

A comment that has a numbered list is the open choice list of its conversation.
A conversation is one issue or PR, or one PR review thread. The list stays open
for one hour (the `awaitChoice` default timeout).

A reply answers the list when its text (with any bot mention removed) is one of
these:

- A listed number: `2`, `#2`, or `2.`
- An option label, with case ignored.

The reply does not need to mention the bot. It becomes an interaction, so an
`awaitChoice` waiter resolves, or the button's `onClick` handler runs.

## Persistence

### History

GitHub holds the conversation, so the adapter keeps no history store.
`GitHubConversationStore` rebuilds the agent messages from GitHub on every
turn:

- An issue or PR conversation reads the issue comments.
- A review thread reads the comments of that thread.
- The first message gives the issue or PR title, URL, and description. In a
  review thread, it also gives the file, the line, and the diff hunk.
- Comments the adapter wrote become assistant messages. Other comments become
  user messages, with the bot mention removed.
- Only the newest 50 messages are kept.

Every comment the adapter writes ends with a hidden HTML marker,
`<!-- copilotkit-channels -->`. A comment is the bot's own when the posting
account wrote it and it is a bot account or carries the marker. So a personal
access token of your own works: your comments stay user messages.

### State store

`stateStore` holds the open numbered choices. The default `MemoryStore` loses
them on restart.

`thread.awaitChoice` waits inside the process that posted the list, so the
reply must reach that same process. Run one instance, or send each repository's
webhooks to the same instance. A shared `StateStore` does not change this:
another instance would take the reply, but it cannot resume the waiting run.

The engine's `ActionStore` (from `@copilotkit/channels`) holds the button
handlers. It is in-memory by default. Pass a durable one to
`createChannel({ actionStore })` to keep handlers across restarts.

## Built-ins

- `defaultGitHubContext`: two context entries. Spread it into `context`.
- `gitHubFormattingContext`: the Markdown that renders on GitHub (tables, task
  lists, fenced code, `<details>` blocks, `@login`, `#number`).
- `gitHubDeliveryContext`: replies stream into one edited comment, long replies
  continue in a new comment, and choices are numbered lists.

## Tool context

Tools receive the shared `ChannelToolContext` from `@copilotkit/channels`
(`{ thread, message?, user?, signal?, platform }`). `platform` is `"github"`.
GitHub features come through `thread` methods that this adapter backs:

- `thread.getMessages()`: the comments of the current conversation, oldest
  first.
- `thread.post(...)`, `thread.update(...)`, `thread.delete(...)`: post, edit,
  and delete comments.
- `thread.react(ref, emoji)` / `thread.unreact(ref, emoji)`: reactions on a
  comment.

`thread.lookupUser(query)` always returns `undefined`. The adapter does not
search GitHub users.

## What's not in v1

- No modals, ephemeral messages, or files (`postFile` is not supported).
- No inbound reactions. GitHub sends no reaction webhooks.
- No GitHub Discussions, commit comments, or replies to `issues.opened`.
- No managed (cloud-hosted Intelligence) GitHub connection. This is a direct
  adapter only.

## Exports

- Adapter: `github`, `GitHubAdapter`, and the types `GitHubAdapterOptions`,
  `ReplyTarget`, `GitHubMessageRef`, `GitHubUser`, `GitHubRepository`,
  `GitHubInstallation`, `GitHubComment`, `IssueCommentEvent`,
  `PullRequestReviewCommentEvent`.
- Webhooks: `createWebhookHandler`, `GitHubWebhookServer`, and the types
  `GitHubWebhookEvent`, `GitHubWebhookHandlerOptions`,
  `GitHubWebhookServerOptions`.
- REST and auth: `GitHubApiClient`, `GitHubApiError`, `GitHubAppTokenProvider`,
  `StaticTokenProvider`, and the types `GitHubApiClientOptions`,
  `GitHubCommentRef`, `GitHubReactionContent`, `GitHubAppTokenProviderOptions`,
  `GitHubTokenProvider`.
- Rendering and runs: `renderGitHubMessage`, `CHOICE_PROMPT`,
  `VALUE_ONLY_CHOICE_ID`, `GITHUB_LIMITS`, `truncateText`, `conversationKeyOf`,
  `GitHubConversationStore`, `createRunRenderer`, and the types
  `RenderedChoice`, `GitHubConversationStoreOptions`, `GitHubRunRenderer`,
  `GitHubRunRendererOptions`.
- Built-in context: `defaultGitHubContext`, `gitHubFormattingContext`,
  `gitHubDeliveryContext`.
