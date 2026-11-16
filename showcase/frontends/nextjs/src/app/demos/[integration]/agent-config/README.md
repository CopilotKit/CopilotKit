# Agent config

Users want to steer the agent: a casual tone, explanations for beginners, short answers. This demo sends a typed config with every run, so the agent changes its replies from one turn to the next.

## Try it

1. Open `/demos/<integration>/agent-config`.
2. Set "Tone" to `casual` and "Response length" to `detailed`.
3. Send a message.

The reply uses the new tone and length.

## How it works

- `use-agent-config.ts` holds the config: tone, expertise, and response length.
- `config-context-relay.tsx` publishes the config with `useAgentContext`. The agent adds this context to the model's prompt.
- `config-card.tsx` renders one select for each field of the config.

## Agents that read forwardedProps

Some agents read the config from the run's `forwardedProps`, not from the agent context. For these integrations, the page also passes the config as the provider's `properties`.

To turn this on, add `src/integrations/<slug>/demos/agent-config.ts`:

```ts
import type { AgentConfigDemoSettings } from "@/app/demos/[integration]/agent-config/demo-settings";

export default {
  readsForwardedProps: true,
} satisfies AgentConfigDemoSettings;
```

`page.tsx` loads this file on the server and passes it to `AgentConfigDemo`. If the file does not exist, the page uses `DEFAULT_DEMO_SETTINGS`.

## What the integration needs

- An agent for `createRuntimeConfig("agent-config")`, with the id `agent-config-demo`.

Each run now carries the current config, so a change takes effect on the next message.
