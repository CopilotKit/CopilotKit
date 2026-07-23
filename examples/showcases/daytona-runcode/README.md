# CopilotKit × Daytona — `runCode` showcase

The deployable demo behind the [Daytona cookbook recipe](../../../showcase/shell-docs/src/content/docs/cookbook/daytona.mdx).
A minimal CopilotKit **Built-in Agent** app whose only added capability is a `runCode` server tool that executes
Python / TypeScript / JavaScript inside an isolated [Daytona](https://www.daytona.io) sandbox and streams the
result back to the chat — with a custom `useRenderTool` card (fixed-height streaming code pane with
syntax highlighting and a fixed-height result pane).

## What's inside

- `app/api/copilotkit-single/route.ts` — the recipe's `runCode` tool wired into a `BuiltInAgent` on
  `createCopilotEndpointSingleRoute`. Pure recipe code (Python/TS/JS via `daytona.create({ language })`).
- `app/page.tsx` — `CopilotKitProvider` + `CopilotSidebar` + a `useRenderTool({ name: "runCode" })`
  renderer using `react-syntax-highlighter` (Prism + `vscDarkPlus`, mirroring
  `@copilotkit/react-ui`'s own `CodeBlock`).
- A system prompt that tells the agent the tool result is rendered directly to the user, so it
  doesn't restate stdout in chat text.

## Prerequisites

- Node 18+
- An OpenAI API key (`OPENAI_API_KEY`) — the recipe defaults to `openai:gpt-5.4-mini`, overridable via
  the `MODEL` env var.
- A Daytona API key (`DAYTONA_API_KEY`) — create one in the
  [Daytona dashboard](https://app.daytona.io/dashboard/keys).

## Run locally

```bash
npm install
echo "OPENAI_API_KEY=sk-…"      > .env.local
echo "DAYTONA_API_KEY=…"       >> .env.local
npm run dev   # http://localhost:3000
```

Open the page, click into the sidebar chat, and ask something like:

> Run a Python snippet that prints the first 10 Fibonacci numbers.

> Run JavaScript that logs Date.now().

## Notes

- This is a **standalone npm project** — intentionally not in the monorepo's `pnpm-workspace.yaml`.
  `npm install` here installs against published `@copilotkit/*@1.58.0`, which is the same surface the
  recipe targets.
- `new Daytona()` throws at module load if `DAYTONA_API_KEY` is missing, so the app won't boot without
  it. That's by design — the key is required, not optional.
- For arbitrary languages beyond Python/TS/JS, swap `sandbox.process.codeRun` for
  `sandbox.process.executeCommand(...)` and optionally use a custom Daytona `Image` with the toolchain
  preinstalled. See the recipe's _Going further_ section.
