# @copilotkit/channels

`@copilotkit/channels` is the batteries-included CopilotKit Channels package. One install
provides the engine, JSX vocabulary, UI primitives, testing API, and every supported adapter.

A Channel with direct adapters runs in any Node process: call
`channel.start()`. No Intelligence key is needed. CopilotKit Intelligence is an
option that adds managed Slack and Teams, durable threads, the Channels
dashboard, and Memory. With Intelligence, the `CopilotRuntime` starts and stops
the Channel for you.

## Install

```sh
pnpm add @copilotkit/channels
```

Configure TypeScript to use the Channels JSX runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@copilotkit/channels"
  }
}
```

```tsx
import { createChannel, Message, Section } from "@copilotkit/channels";
import { slack } from "@copilotkit/channels/slack";

const channel = createChannel({
  identifyUser: "platform",
  adapters: [
    slack({
      botToken: process.env.SLACK_BOT_TOKEN!,
      appToken: process.env.SLACK_APP_TOKEN!,
    }),
  ],
});

channel.onMessage(({ thread, message }) =>
  thread.post(
    <Message>
      <Section>Echo: {message.text}</Section>
    </Message>,
  ),
);

await channel.start(); // channel.stop() tears it down
```

To run the same Channel through CopilotKit Intelligence instead, give it a
project-unique `name` and declare it on the runtime. The runtime starts it, so
do not also call `channel.start()`:

```ts
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

const runtime = new CopilotRuntime({
  intelligence: new CopilotKitIntelligence({
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY!, // free tier available
  }),
  channels: [channel], // createChannel({ name: "support-bot", ... })
});

const listener = createCopilotNodeListener({ runtime });
await listener.channels.ready(); // listener.channels.stop() tears it down
```

## Adapter entry points

- `@copilotkit/channels/slack` (plus `/slack/codec` and `/slack/render`)
- `@copilotkit/channels/teams` (plus `/teams/render`)
- `@copilotkit/channels/discord`
- `@copilotkit/channels/whatsapp`
- `@copilotkit/channels/resend` (email through Resend)

One package version gives you a tested snapshot of the core engine, JSX/UI vocabulary,
testing helpers, and every adapter listed above.

`@copilotkit/channels/teams` needs the Microsoft 365 Agents SDK, which is an
**optional peer dependency** and is not installed for you:

```sh
pnpm add @microsoft/agents-hosting @microsoft/agents-activity
```

Only the self-hosted Teams adapter needs it. `@copilotkit/channels/teams/render`
does not, which is why the SDK stays out of installs that never run a Teams
ingress. `express` is an optional peer as well, loaded lazily and needed only by
the built-in `createTeamsServer` listener.

For adapter authoring or a selective dependency graph, install
`@copilotkit/channels-core` plus the direct adapter package you need, for example:

```sh
pnpm add @copilotkit/channels-core @copilotkit/channels-slack
```
