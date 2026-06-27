# CopilotKit x ShadCN

https://github.com/user-attachments/assets/f0059b04-ad68-4563-ad7a-e574c64e42d0

A compact Next.js example showing how to build a custom CopilotKit chat UI with
ShadCN-style primitives. It uses `useAgent` with a CopilotKit Built-in Agent at
`/api/copilotkit`, renders assistant messages with local chat components, and
includes two frontend interactions:

- A generated line chart rendered through `useFrontendTool`
- A human-in-the-loop taco rain picker rendered through `useHumanInTheLoop`

The app intentionally keeps the chat prompt fixed to make the demo repeatable.

## Prerequisites

- Node.js 20 or newer
- pnpm, via Corepack or your local install. The example declares
  `pnpm@10.33.4` in `package.json`.
- An OpenAI API key

## Environment Variables

Create a local environment file:

```bash
cp .env.example .env.local
```

Then set:

```bash
OPENAI_API_KEY=sk-...
COPILOTKIT_MODEL=openai/gpt-5.4
```

`OPENAI_API_KEY` is required for the Built-in Agent. `COPILOTKIT_MODEL` is
optional and defaults to `openai/gpt-5.4` in `app/api/copilotkit/route.ts`.

## Setup

From this example directory:

```bash
cd examples/shadcn
corepack enable
pnpm install
pnpm dev
```

Open the local URL printed by Next.js, usually
`http://localhost:3000`.

## Try It

Press the send button to run each queued example:

1. Ask for a brief explanation of ShadCN
2. Render a simple generated line chart
3. Open the taco rain picker, choose an emoji, and make it rain

Use the reset button in the chat header to replay the sequence.

## Available Checks

```bash
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm check-types` is also available as an alias for `pnpm typecheck`.
