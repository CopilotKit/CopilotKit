# @copilotkit/channels

`@copilotkit/channels` is the batteries-included CopilotKit Channels package. One install
provides the engine, JSX vocabulary, UI primitives, testing API, and every supported adapter.

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
```

## Adapter entry points

- `@copilotkit/channels/slack` (plus `/slack/codec` and `/slack/render`)
- `@copilotkit/channels/teams` (plus `/teams/render`)
- `@copilotkit/channels/discord`
- `@copilotkit/channels/telegram`
- `@copilotkit/channels/whatsapp`
- `@copilotkit/channels/intelligence` for the curated `intelligenceAdapter` factory and `IntelligenceAdapterOptions` type

One package version gives you a tested snapshot of the core engine, JSX/UI vocabulary,
testing helpers, and every adapter listed above.

For adapter authoring or a selective dependency graph, install
`@copilotkit/channels-core` plus the direct adapter package you need, for example:

```sh
pnpm add @copilotkit/channels-core @copilotkit/channels-slack
```
