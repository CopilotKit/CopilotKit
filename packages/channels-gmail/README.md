# @copilotkit/channels-gmail

The **Gmail `PlatformAdapter`** for [`@copilotkit/channels`](../channels). It
lets an agent answer email in one Gmail mailbox.

- Gmail tells Pub/Sub about new mail (`users.watch`). A Pub/Sub push
  subscription posts to the adapter's handler. The adapter verifies the push
  and reads new mail with `users.history.list`.
- Each email thread is one conversation. Every email in the intake label
  (default `INBOX`) is addressed to the bot (`mentioned: true`).
- The reply is one email in the same thread, with HTML and plain text.
- It uses plain `fetch` against the Gmail REST API. No `googleapis` package.

The Channel runs in your own process: call `channel.start()`. No
Intelligence key is needed.

## Install

```sh
pnpm add @copilotkit/channels @copilotkit/channels-gmail
```

## Quickstart

```ts
import { createChannel } from "@copilotkit/channels";
import { gmail } from "@copilotkit/channels-gmail";

const gmailAdapter = gmail({
  oauth: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN!,
  },
  topicName: process.env.GMAIL_PUBSUB_TOPIC!, // projects/<project>/topics/<topic>
  pubsubAuth: { audience: "https://bot.example.com/gmail" },
  port: 3000, // or mount gmailAdapter.handler on your own route
});

const channel = createChannel({
  identifyUser: "platform",
  adapters: [gmailAdapter],
  agent: makeAgent,
});

channel.onMention(async ({ thread }) => {
  await thread.runAgent();
});

await channel.start();
```

See the Gmail adapter page in the CopilotKit docs for the Google Cloud setup:
the Gmail API, the Pub/Sub topic and push subscription, and OAuth scopes.

## Notes

- **Push verification.** `pubsubAuth` checks the OIDC token Pub/Sub signs.
  `verificationToken` checks a `?token=` value in the push URL instead. The
  token option is simpler, but the token is in the URL and can end up in logs.
- **State.** The adapter stores its Gmail cursor, processed message ids, and
  used action links in `store`. The default is in memory. Pass the same
  durable store you give `createChannel`.
- **Buttons.** Set `actions: { baseUrl, secret }` to render handler buttons
  and select options as signed links. A link opens a confirm page; the
  click runs on confirm, once. Without `actions`, those controls show only
  their label. Link buttons (`<Button url>`) always work.
- **No edit or delete.** Sent email cannot change. `thread.update` and
  `thread.delete` throw. There are no reactions, modals, typing, or
  ephemeral messages.
