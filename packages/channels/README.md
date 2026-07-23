# @copilotkit/channels

`@copilotkit/channels` is the batteries-included CopilotKit Channels package. One install
provides the engine, JSX vocabulary, UI primitives, testing API, and every supported adapter.

> **Beta / breaking change.** As of this release adapters are **declarative and
> credential-free** — `slack()`, not `slack({ botToken, appToken })` — and a
> `Channel` no longer starts itself. Credentials and connectivity are supplied
> by CopilotKit Intelligence (the recommended path) or a custom Channel runner.
> See the quick start below. (Old: `slack({ …tokens })` + `channel.start()`;
> new: `slack()` + `new CopilotRuntime({ intelligence, channels })`.)

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

## Quick start

```tsx
import { createChannel, Message, Section } from "@copilotkit/channels";
import { slack } from "@copilotkit/channels/slack";
import { CopilotRuntime } from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const support = createChannel({
  name: "support",
  agent: new HttpAgent({ url: process.env.AGENT_URL! }), // or "billing" | router | omitted → "default"
  adapters: [slack()], // credential-free
});

support.onMessage(({ thread, message }) =>
  thread.post(
    <Message>
      <Section>Echo: {message.text}</Section>
    </Message>,
  ),
);

// CopilotKit Intelligence supplies credentials, connectivity, delivery, and failover:
const runtime = new CopilotRuntime({
  intelligence,
  identifyUser,
  channels: [support],
});
```

Credentials (bot tokens, signing secrets, client IDs) are no longer passed to
the adapter factory — they're configured once in CopilotKit Intelligence (the
connector). Running Channels without Intelligence requires implementing a
custom `ChannelRunner` (an advanced, exported-but-undocumented escape hatch).
There's also no public `channel.start()` — the Runtime drives a Channel's
lifecycle once it's declared in `channels: [...]`.

See `@copilotkit/channels-core` for the full `createChannel` reference
(the four `agent` binding modes, `tools`/`context`/`commands`/`components`/`store`,
and the response defaults for shared channels/threads).

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
