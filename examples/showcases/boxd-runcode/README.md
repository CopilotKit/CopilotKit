# CopilotKit × boxd: `runCode` showcase

The demo app behind the [boxd cookbook recipe](../../../showcase/shell-docs/src/content/docs/cookbook/boxd.mdx).
A minimal CopilotKit **Built-in Agent** app whose only added capability is a `runCode` server tool. The tool
creates a fresh, isolated [boxd](https://boxd.sh?ref=CopilotKit) machine, runs Python, TypeScript or JavaScript
on it, returns the result to the chat, and deletes the machine. A custom `useRenderTool` card shows the code
as it streams in and the output when it finishes.

## What's inside

- `app/api/copilotkit-single/route.ts`: the recipe's `runCode` tool wired into a `BuiltInAgent` on
  `createCopilotEndpointSingleRoute`. Pure recipe code: `boxd.machines.create({ isolated: true })`,
  `fs.write` for the code, `exec` to run it, `delete` in a `finally` block.
- `app/page.tsx`: `CopilotKitProvider` + `CopilotChat` + a `useRenderTool({ name: "runCode" })`
  renderer using `react-syntax-highlighter` (Prism + `vscDarkPlus`, mirroring
  `@copilotkit/react-ui`'s own `CodeBlock`).
- A system prompt that tells the agent the tool result is rendered directly to the user, so it
  doesn't restate the output in chat text.

## Prerequisites

- Node 20+
- An OpenAI API key (`OPENAI_API_KEY`). The recipe defaults to `openai:gpt-6-luna`, overridable via
  the `MODEL` env var.
- A boxd API key (`BOXD_API_KEY`). Create one in the [boxd console](https://app.boxd.sh?ref=CopilotKit)
  or with `boxd auth keys create copilotkit`. Set `BOXD_ORG` to create machines in an organization,
  and `BOXD_REGION` (`fra` or `nyc`) to pick a region.

## Run locally

```bash
npm install
echo "OPENAI_API_KEY=sk-…"      > .env.local
echo "BOXD_API_KEY=…"          >> .env.local
npm run dev   # http://localhost:3000
```

Open the page, click into the chat, and ask something like:

> Run a Python snippet that prints the first 10 Fibonacci numbers.

> Run JavaScript that logs Date.now().

## Notes

- This is a **standalone npm project**, intentionally not in the monorepo's `pnpm-workspace.yaml`.
  `npm install` here installs against published `@copilotkit/*@1.58.0`, which is the same surface the
  recipe targets.
- Each tool call gets its own machine, and the machine is deleted when the call ends, also when the
  code fails or times out (60 seconds).
- Machines are created with `isolated: true`: they are not on your organization's private network and
  hold no boxd credentials. They do have outbound internet access.
- For other languages, add an entry to `runners` in the route, or pass a shell command line to
  `boxd.machines.exec(...)`. Every machine is a full Ubuntu system with Python, Node, Go and Docker.
