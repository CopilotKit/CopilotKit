# @copilotkit/channels

`@copilotkit/channels` is the batteries-included CopilotKit Channels package. One install
provides the engine, JSX vocabulary, UI primitives, testing API, and every supported adapter.

**Channels run through a channel runner.** CopilotKit Intelligence provides the
managed runner, available on a free plan: the `CopilotRuntime` starts and owns
each Channel's lifecycle once Intelligence is configured. You can also build and
operate your own channel runner on the lower-level SDK primitives, with no
Intelligence dependency — a supported path where your team owns state,
persistence, concurrency, locking, retries, and race-condition handling.

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
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

const channel = createChannel({
  name: "support-bot", // project-unique Intelligence Channel name
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

// The runtime owns the Channel's lifecycle — there is no `channel.start()`.
const runtime = new CopilotRuntime({
  intelligence: new CopilotKitIntelligence({
    // apiUrl and wsUrl default to the managed Intelligence platform — override
    // both together only for a self-hosted deployment.
    apiKey: process.env.INTELLIGENCE_API_KEY!, // free tier available
  }),
  channels: [channel],
});

// Creating the listener starts the Channel's connection.
const listener = createCopilotNodeListener({ runtime });
// Optional: await that activation so a broken config fails startup loudly.
await listener.channels.ready(); // listener.channels.stop() tears it down
```

## Adapter entry points

- `@copilotkit/channels/slack` (plus `/slack/codec` and `/slack/render`)
- `@copilotkit/channels/teams` (plus `/teams/render`)
- `@copilotkit/channels/discord`
- `@copilotkit/channels/telegram`
- `@copilotkit/channels/whatsapp`

One package version gives you a tested snapshot of the core engine, JSX/UI vocabulary,
testing helpers, and every adapter listed above.

For adapter authoring or a selective dependency graph, install
`@copilotkit/channels-core` plus the direct adapter package you need, for example:

```sh
pnpm add @copilotkit/channels-core @copilotkit/channels-slack
```
