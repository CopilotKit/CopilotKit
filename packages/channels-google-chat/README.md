# @copilotkit/channels-google-chat

The **Google Chat `PlatformAdapter`** for [`@copilotkit/channels`](../channels).
It connects a Google Chat app to any AG-UI agent. Events arrive on an HTTPS
webhook. Replies go out through the Chat REST API, and the adapter streams them
by editing one message in place. Cards are rendered from the
`@copilotkit/channels-ui` JSX vocabulary as Cards v2.

## Install

```sh
pnpm add @copilotkit/channels @copilotkit/channels-google-chat @copilotkit/runtime @ag-ui/client
```

The adapter is also available from the umbrella package as
`@copilotkit/channels/google-chat`.

## Quickstart

```ts
import { HttpAgent } from "@ag-ui/client";
import { createChannel } from "@copilotkit/channels";
import {
  googleChat,
  defaultGoogleChatContext,
} from "@copilotkit/channels-google-chat";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

const bot = createChannel({
  identifyUser: "platform",
  name: "helper",
  adapters: [
    googleChat({
      // The exact "HTTP endpoint URL" from the Chat app configuration.
      endpointUrl: "https://bot.example.com/google-chat",
      // Required for a Chat app built as a Google Workspace add-on.
      workspaceAddOnServiceAccountEmail: process.env.GOOGLE_CHAT_ADDON_SA,
      port: 3000,
      path: "/google-chat",
    }),
  ],
  // Any AG-UI agent. Here: an agent served over HTTP at AGENT_URL.
  agent: new HttpAgent({ url: process.env.AGENT_URL! }),
  context: [...defaultGoogleChatContext],
});

bot.onMention(async ({ thread }) => {
  await thread.runAgent();
});

const runtime = new CopilotRuntime({
  intelligence: new CopilotKitIntelligence({
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY!,
  }),
  channels: [bot],
});
const listener = createCopilotNodeListener({ runtime });
await listener.channels.ready();
```

## Set up the Chat app

1. In a Google Cloud project, enable the **Google Chat API**.
2. Create a service account and a JSON key for it. Set
   `GOOGLE_CHAT_CREDENTIALS` to the key JSON or to the key file path. If you
   do not set it, the adapter uses Application Default Credentials.
3. In **Google Chat API → Configuration**, set the connection to **HTTP
   endpoint URL** and enter your public webhook URL.
4. Set **Authentication audience**, and give the adapter the matching option:
   - **HTTP endpoint URL**: set `endpointUrl` to the same URL.
   - **Project number**: set `googleChatProjectNumber` to the project number.
5. If the app is built as a Google Workspace add-on, set `endpointUrl` and
   `workspaceAddOnServiceAccountEmail`
   (`service-<projectNumber>@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`).
   Add-on apps send card clicks to a URL, so card buttons need `endpointUrl`.
6. Optional: add slash commands. A command named `/summarize` reaches
   `bot.onCommand("summarize", …)`. A quick command carries only its command
   ID, so register it by that ID: command ID 2 reaches `bot.onCommand("2", …)`.

For local development, expose the port with a tunnel such as `ngrok`.
`disableSignatureVerification: true` turns off webhook verification. Use it
only on your own machine.

## Options

| Option                              | Description                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `endpointUrl`                       | Public webhook URL. Verifies endpoint-URL tokens and routes card clicks on add-on apps.                         |
| `googleChatProjectNumber`           | Verifies project-number tokens.                                                                                 |
| `workspaceAddOnServiceAccountEmail` | Your add-on's own service account. Tokens from other add-ons are rejected.                                      |
| `credentials`                       | Service-account key: an object, a JSON string, or a file path. Default: `GOOGLE_CHAT_CREDENTIALS`, then ADC.    |
| `port`, `path`                      | Start a webhook server on `port` at `path` (default `/`). Without `port`, mount `adapter.nodeHandler` yourself. |
| `botUserId`                         | The app's own `users/…` name. Without it, any @-mention of an app counts as a mention.                          |
| `historyStore`                      | Transcript persistence. Default: in memory.                                                                     |
| `showToolStatus`                    | Post a status row for each tool call. Default `true`.                                                           |
| `disableSignatureVerification`      | Skip webhook verification. Local development only.                                                              |

You must set `endpointUrl` or `googleChatProjectNumber`, or the constructor
throws. With both set, the adapter accepts either token.

## How it behaves

- **Two event formats.** The adapter reads the Chat API event format and the
  Workspace add-on event format, so it works with either kind of Chat app.
- **Acknowledge first.** The webhook replies `200` as soon as the token is
  verified. The agent runs after that, and its replies go out through the REST
  API, so a long run does not hit Google's 30-second webhook timeout.
- **Conversations.** In a space, each thread is one conversation, and Google
  Chat sends the app only the messages that @-mention it. In a direct message,
  the whole space is one conversation, and the app gets every message.
- **History.** Reading Chat history needs admin-approved scopes, so the adapter
  keeps its own transcript of user messages and agent replies. It gives this
  transcript to the agent on every turn.
- **Streaming.** Agent text streams into one message by editing it in place.
  Text longer than one message continues in a new message.
- **Cards.** `<Header>`, `<Section>`, `<Markdown>`, `<Fields>`, `<Field>`,
  `<Context>`, `<Image>`, `<Divider>`, `<Table>`, `<Button>` (including link
  buttons), and `<Select>` render as Cards v2. `awaitChoice` works with buttons
  and selects. `<Input>`, `<Chart>`, and `<Carousel>` are skipped.
- **Not supported.** Modals, reactions, typing indicators, file uploads, and
  user lookup.

## Testing

`src/e2e.test.ts` runs the real adapter, the real channel engine, and an AG-UI
agent against a local stand-in for the Chat REST API. It sends webhooks with
RS256 tokens that `google-auth-library` verifies. It checks verification,
threaded and direct-message replies, streaming edits, history replay, and an
`awaitChoice` button round trip in both event formats.

```sh
nx run @copilotkit/channels-google-chat:test
```
