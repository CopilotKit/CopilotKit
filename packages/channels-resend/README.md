# @copilotkit/channels-resend

Email adapter for [CopilotKit Channels](https://docs.copilotkit.ai/reference/channels/sdk/resend), built on [Resend](https://resend.com).

People email your agent. Each email thread is one conversation. The agent
replies in the same thread.

```ts
import { createChannel } from "@copilotkit/channels";
import { resend } from "@copilotkit/channels/resend";

const email = resend({
  apiKey: process.env.RESEND_API_KEY!,
  from: "Support <support@example.com>",
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
});

const channel = createChannel({ adapters: [email], agent });
channel.onMessage(async ({ thread }) => {
  await thread.runAgent();
});
await channel.start();

// Mount the handler on the URL you gave Resend as the webhook:
export const POST = email.handler;
```

- Inbound: Resend's `email.received` webhook. The adapter checks the Svix
  signature and reads the body and attachments from the Resend API.
- Outbound: one email per reply, with `In-Reply-To`, `References`, and a
  `Re:` subject. No streaming, editing, or deleting.
- Buttons: set `actions: { baseUrl, secret }` to turn handler buttons into
  signed, single-use links.

See the [Resend adapter docs](https://docs.copilotkit.ai/reference/channels/sdk/resend)
for setup.
