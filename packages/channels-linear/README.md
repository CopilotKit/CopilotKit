# @copilotkit/channels-linear

The **Linear `PlatformAdapter`** for [`@copilotkit/channels`](../channels). It
makes any AG-UI agent a Linear agent. People in your Linear workspace can
@mention the agent or delegate an issue to it. The agent answers in the agent
session, and its thoughts and tool calls show in the session too.

You write your UI as JSX once (`@copilotkit/channels-ui`) and drive the agent
with `@copilotkit/channels`. This package is the only one that talks to the
Linear Agent API.

The adapter keeps its own Linear credentials (`accessToken` and
`webhookSecret`). The Channel runs inside a `CopilotRuntime` with a CopilotKit
Intelligence connection, which starts and stops the adapter.

## Install

```sh
pnpm add @copilotkit/channels @copilotkit/channels-linear
```

The umbrella package also exports this adapter from
`@copilotkit/channels/linear`.

## Quickstart

```ts
import { createChannel } from "@copilotkit/channels";
import { linear, defaultLinearContext } from "@copilotkit/channels-linear";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

const channel = createChannel({
  identifyUser: "platform",
  name: "linear-agent", // unique among the Channels on this runtime
  adapters: [
    linear({
      accessToken: process.env.LINEAR_ACCESS_TOKEN!,
      webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
      port: 3000, // built-in webhook server on POST /webhook
    }),
  ],
  agent: makeAgent,
  context: [...defaultLinearContext],
});

// Every session event is a mention or a delegation, so run the agent.
channel.onMessage(async ({ thread }) => {
  await thread.runAgent();
});

const runtime = new CopilotRuntime({
  agents: {},
  intelligence: new CopilotKitIntelligence({
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY!,
  }),
  channels: [channel],
});

// Creating the listener starts the Channel and the adapter's webhook server.
const listener = createCopilotNodeListener({ runtime });
await listener.channels.ready();
```

`linear(opts)` returns a `LinearAdapter`. With `port` set, `start()` runs a
`node:http` server:

- `POST /webhook` (or your `path`): the Linear webhook.
- `GET /`: health check, answers `200 ok`.

Without `port`, no server starts. Mount `adapter.handleWebhook(request)` on a
route of your own server. It takes a fetch `Request` and returns a `Response`:

```ts
app.post("/linear/webhook", (c) => adapter.handleWebhook(c.req.raw));
```

The webhook URL must be public. For local development, use a tunnel such as
ngrok.

### Required env

| Var                     | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `LINEAR_ACCESS_TOKEN`   | OAuth access token of the app actor (installed with `actor=app`). |
| `LINEAR_WEBHOOK_SECRET` | Webhook signing secret from the Linear app settings.              |

The adapter reads no environment variables itself. Pass the values as options.

## Linear app setup

1. Create an OAuth app in Linear (Settings, then API, then Applications).
2. Turn on webhooks for the app and select the **Agent session events**
   category. Set the webhook URL to your public endpoint.
3. Install the app with `actor=app` and the scopes `app:mentionable` and
   `app:assignable`. Exchange the code for an access token.
4. Start the Channel. Mention the agent in an issue comment, or delegate an
   issue to it.

The full walkthrough is in the docs page `channels/linear`.

## Webhook handling

`handleWebhook` accepts POST only. For each request it:

1. Checks the `Linear-Signature` header: the hex HMAC-SHA256 of the raw body
   with `webhookSecret`.
2. Checks that `webhookTimestamp` is at most 60 s from the current time.
3. Reads the state that the event needs, for example a pending choice. If
   this read fails, it answers `500`, and Linear retries the delivery.
4. Answers `200` and handles the event after the response.

| Response | Cause                                                              |
| -------- | ------------------------------------------------------------------ |
| `405`    | The method is not POST.                                            |
| `401`    | Bad `Linear-Signature`, or the timestamp is more than 60 s off.    |
| `400`    | The body is not a JSON object.                                     |
| `500`    | The adapter cannot read the event. Linear retries the delivery.    |
| `200`    | All other requests. Only `AgentSessionEvent` payloads are handled. |

The adapter handles two `AgentSessionEvent` actions:

- `created`: a user mentioned the agent or delegated an issue to it. The
  adapter posts an ephemeral `thought` ("Looking into this…") at once, because
  Linear expects activity within 10 s. Then it starts a turn.
- `prompted`: a user sent a new message into the session. The message starts
  a turn, answers a pending choice, or stops the run (see below).

## Capabilities

| Capability               | Supported | Notes                                                         |
| ------------------------ | --------- | ------------------------------------------------------------- |
| `supportsMessageEvents`  | true      | Every session event is a turn.                                |
| `supportsTyping`         | true      | The first ephemeral `thought` is the typing signal.           |
| `supportsBlockingChoice` | true      | `awaitChoice` uses an `elicitation` with the `select` signal. |
| `supportsStreaming`      | false     | Linear activities cannot be edited.                           |
| `supportsModals`         | false     | Linear has no modal surface for agents.                       |
| `supportsReactions`      | false     | The Agent API has no reactions.                               |
| `supportsEphemeral`      | false     | No per-user hidden messages.                                  |

Linear activities cannot be edited or deleted. As a result:

- `thread.stream(...)` buffers the full iterable and posts one `response`.
- `update` posts the new content as a new activity in the same session.
- `delete` does nothing.

`defaultLinearContext` tells the agent about these limits, so it does not
promise to update a message.

## `LinearAdapterOptions` reference

| Option                | Type                                        | Default                            | Description                                                                                                                               |
| --------------------- | ------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `accessToken`         | `string \| () => string \| Promise<string>` | required                           | OAuth access token of the app actor, or a function that returns the current token (Linear tokens expire). Sent as `Bearer` on every call. |
| `webhookSecret`       | `string`                                    | required                           | Webhook signing secret. Checks `Linear-Signature`.                                                                                        |
| `port`                | `number`                                    | `undefined`                        | Port of the built-in webhook server. Unset means no server.                                                                               |
| `path`                | `string`                                    | `"/webhook"`                       | Webhook path of the built-in server.                                                                                                      |
| `apiUrl`              | `string`                                    | `"https://api.linear.app/graphql"` | Linear GraphQL endpoint. Overridable for tests.                                                                                           |
| `fetch`               | `typeof fetch`                              | global `fetch`                     | `fetch` for GraphQL calls. Overridable for tests.                                                                                         |
| `stateStore`          | `StateStore`                                | `new MemoryStore()`                | Adapter state, such as pending choices.                                                                                                   |
| `interruptEventNames` | `ReadonlySet<string>`                       | `{"on_interrupt"}`                 | Custom AG-UI event names treated as interrupts.                                                                                           |

## AG-UI to Linear activities

The run renderer posts one activity when each AG-UI message ends. All posts
go through one queue, so activities appear in event order.

| AG-UI event       | Linear activity                                              |
| ----------------- | ------------------------------------------------------------ |
| Text message      | `response`. A long message is split into more activities.    |
| Reasoning message | Ephemeral `thought`.                                         |
| Tool call end     | `action` with the tool name and a one-line argument summary. |
| Tool call result  | The same `action` again, with `result`.                      |
| Run error         | `error`.                                                     |

A failed post is logged. If the last post of the run (the final reply)
fails, `thread.runAgent()` also rejects with that error. A failed earlier post
does not fail the run.

## JSX to Linear rendering

`renderLinearMessage(ir)` turns the `@copilotkit/channels-ui` IR into one
activity with a Markdown body:

- No controls: a `response`.
- Any `Button` or `Select`: an `elicitation` with the `select` signal. Each
  button and each select option is one option in `signalMetadata`.

Other nodes:

- `Header` is a `###` heading.
- `Field` is `**label:** value`.
- `Context` is italic text.
- `Divider` is `---`.
- `Image` is a Markdown image.
- `Table` is a GFM table.
- A `Button` with a `url` is a Markdown link, not an option.

Linear sends a pick back as a `prompt` activity whose body is the option
value. So each option value must be unique in a message. When two labels are
equal, the second gets ` (2)`, the third ` (3)`, and so on. A `multi` select
becomes single choice and resolves with a one-item array.

### Limits

`LINEAR_LIMITS` holds the bounds the renderer cuts against:

| Limit          | Value  | Element                      |
| -------------- | ------ | ---------------------------- |
| `activityBody` | 50,000 | chars in one activity body   |
| `optionValue`  | 200    | chars in one `select` option |

## Choices, interactions, and stop

- **Pending choices.** When the adapter posts an elicitation, it stores the
  options in the adapter `stateStore`, keyed by session. The set expires
  after one hour, the `awaitChoice` default timeout.
- **A pick.** A `prompted` message whose body matches a pending option
  becomes an interaction. The engine then resolves the `awaitChoice` waiter or
  the `onClick` handler. By default, only the person who started the
  `awaitChoice` can answer it.
- **Other text.** A `prompted` message that matches no option starts a normal
  turn.
- **Stop.** A `prompted` activity with the `stop` signal aborts the running
  agent. Queued activities are dropped. The adapter then posts one final
  `Stopped.` response, which Linear needs to mark the session as stopped.

With more than one process behind the webhook URL, pass a shared
`stateStore`. Otherwise a pick that reaches another process is a normal turn.

## Conversation history

One conversation is one agent session. On each turn, `LinearConversationStore`
reads the session from Linear and rebuilds `agent.messages`:

- When the session is on an issue, one user message with the issue context
  comes first.
- `prompt` activities are user messages.
- `response` and `elicitation` activities are assistant messages.
- `thought`, `action`, and `error` activities are left out.

The store reads up to 1000 activities (10 pages of 100) and keeps the last 50
messages. `thread.getMessages()` returns the same messages.

## Built-ins

- `defaultLinearContext`: two context entries. Spread it into `context`.
  - `linearFormattingContext`: the agent is a Linear agent, replies are
    Markdown, and issue identifiers such as `ENG-123` link by themselves.
  - `linearDeliveryContext`: thoughts and actions show in the session,
    messages cannot be edited, and a pick comes back as the next message.

## Tool context

Tools receive the shared `ChannelToolContext` from `@copilotkit/channels`
(`{ thread, message?, user?, signal?, platform }`). This adapter backs:

- `thread.getMessages()`: the session messages, oldest first.

`thread.lookupUser(query)` always returns `undefined`. The adapter does not
read the Linear user directory.

## What is not in v1

- No streaming, reactions, modals, or ephemeral messages.
- No editing or deleting of activities.
- No files: no `postFile` and no inbound attachments.
- No `auth` elicitation (account linking).
- No user directory (`lookupUser` always returns `undefined`).
- No built-in token refresh. Pass `accessToken` as a function that returns a
  valid token.
- A pending choice and a running agent live in one process. A pick or a stop
  that reaches a different process does not reach them. Run one instance, or
  send each workspace's webhooks to the same instance.

## Exports

- Adapter: `linear`, `LinearAdapter`.
- Types: `LinearAdapterOptions`, `ReplyTarget`, `LinearMessageRef`, the
  `*ActivityContent` types, `AgentActivityType`, `AgentActivitySignal`,
  `SelectSignalMetadata`, `AuthSignalMetadata`, `AgentSessionEventWebhook`,
  `LinearWebhookAgentSession`, `LinearWebhookAgentActivity`,
  `LinearWebhookIssue`, `LinearWebhookUser`.
- Webhook: `createWebhookHandler`, `MAX_WEBHOOK_AGE_MS`,
  `WebhookHandlerOptions`, `LinearWebhookServer`,
  `LinearWebhookServerOptions`.
- Client: `LinearApiClient`, `LinearApiError`, and its option and result
  types.
- Rendering: `renderLinearMessage`, `RenderedChoice`, `LINEAR_VALUE_ONLY_ID`,
  `LINEAR_LIMITS`, `truncateText`, `createRunRenderer`,
  `LinearRunRenderer`, `LinearRunRendererArgs`.
- Context: `defaultLinearContext`, `linearFormattingContext`,
  `linearDeliveryContext`.
- History: `conversationKeyOf`, `LinearConversationStore`,
  `LinearConversationStoreOptions`.
