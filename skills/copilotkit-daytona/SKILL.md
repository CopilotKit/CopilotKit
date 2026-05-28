---
name: copilotkit-daytona
description: >
  Use when adding Daytona sandbox code execution to a CopilotKit Built-in Agent. Adds a
  `runCode` server tool that runs Python, TypeScript, or JavaScript in an isolated Daytona
  sandbox and returns the output to the chat. Use when a CopilotKit agent needs to execute
  code it writes, run untrusted/generated code safely, or compute things in a real runtime.
version: 1.0.0
---

# CopilotKit × Daytona

Give CopilotKit's [Built-in Agent](https://docs.copilotkit.ai/built-in-agent) a server tool that runs code
in an isolated [Daytona](https://www.daytona.io) sandbox — a full Linux runtime with its own filesystem,
network, and CPU/RAM — and returns the output to the chat. The agent can then execute code it writes
without touching the host.

This skill **adds a tool to an existing Built-in Agent app**. If there is no CopilotKit app yet, set one up
first with the `copilotkit-setup` skill (or the [Quickstart](https://docs.copilotkit.ai/built-in-agent/quickstart)),
then return here.

## Prerequisites

1. **A running Built-in Agent app** — a `BuiltInAgent` registered on a `CopilotRuntime`. Verify there is a
   runtime route (e.g. `app/api/copilotkit/route.ts`) instantiating `new BuiltInAgent({ model, ... })`. If
   not, stop and run `copilotkit-setup` first.
2. **A Daytona API key** — the user creates one at https://app.daytona.io/dashboard/keys. If
   `DAYTONA_API_KEY` is not set in the environment or `.env`, ask the user for it; do not invent one.
3. **Node 18+** (the app's existing requirement).

## Setup workflow

### Step 1: Install the Daytona SDK

```bash
npm install @daytonaio/sdk
```

### Step 2: Set the API key

Add to the app's `.env` (and to the deployment's secrets):

```plaintext title=".env"
DAYTONA_API_KEY=your_daytona_api_key
```

> The Daytona client (`new Daytona()`) reads `DAYTONA_API_KEY` and **throws at construction if it is
> missing** — so the app will not boot without it. Make sure it is set before starting the server.

### Step 3: Define the `runCode` tool

In the same module that constructs the `BuiltInAgent` (the runtime route), define the tool. See
[assets/daytona-runcode-tool.ts](assets/daytona-runcode-tool.ts) for the full, copy-pasteable version.

```ts
import { defineTool } from "@copilotkit/runtime/v2";
import { Daytona } from "@daytonaio/sdk";
import { z } from "zod";

const daytona = new Daytona(); // reads DAYTONA_API_KEY

const runCode = defineTool({
  name: "runCode",
  description:
    "Execute code in an isolated Daytona sandbox and return its output.",
  parameters: z.object({
    code: z.string().describe("The code to run in the sandbox"),
    language: z
      .enum(["python", "typescript", "javascript"])
      .default("python")
      .describe("Language runtime for the code"),
  }),
  execute: async ({ code, language }) => {
    const sandbox = await daytona.create({ language });
    try {
      const res = await sandbox.process.codeRun(code);
      return { stdout: res.result, exitCode: res.exitCode };
    } finally {
      await sandbox.delete();
    }
  },
});
```

Each call creates a fresh sandbox, runs the code, returns stdout + exit code, and deletes the sandbox in a
`finally` — so every invocation is isolated. `codeRun` runs in the runtime chosen at sandbox creation;
`language` defaults to `python`.

### Step 4: Register the tool on the agent

Add `runCode` to the agent's `tools` array, and ensure `maxSteps >= 2` so the agent can call the tool and
then respond:

```ts
const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini", // keep the app's existing model
  tools: [runCode], // [!add]
  maxSteps: 2, // required so the agent can call the tool, then answer
});
```

Do not change the app's existing model or runtime/endpoint wiring — only add the tool and `maxSteps`.

### Step 5: Verify

1. Start the app and open the chat.
2. Ask: _"Use runCode to run a Python snippet that prints the first 10 Fibonacci numbers."_ Confirm the
   agent calls `runCode` and the real output comes back.
3. Test another runtime: _"Run JavaScript that logs Date.now()."_ — confirm `language: "javascript"` is used.

For an automated check, drive the runtime endpoint directly: POST an `agent/run` request whose message asks
the agent to print a unique random token via `runCode`, then confirm that token appears in the streamed
response (it can only appear if the code actually executed in the sandbox).

## Languages & other runtimes

- `codeRun` covers **python**, **typescript**, **javascript** (set via `language` at sandbox creation).
- For **any other language** (Go, Rust, a shell pipeline), use `sandbox.process.executeCommand("...")`
  instead — the sandbox is a full Linux box. For toolchains not present by default, create the sandbox from
  a **custom image** that installs them.

See [references/daytona-sandboxes.md](references/daytona-sandboxes.md) for sandbox lifecycle, preview URLs,
custom images, and network-tier limits.

## Notes & gotchas

- **Networking on the free tier** — Daytona Tier 1 & 2 organizations run sandboxes with restricted
  networking, but package registries (npm, PyPI) and major AI APIs (OpenAI, Anthropic, Google) are
  whitelisted. Code that must reach arbitrary external URLs needs Tier 3+.
- **Cost vs. isolation** — creating and deleting a sandbox per call is the simplest and most isolated
  pattern. To reduce per-call latency, lazily create and cache one sandbox and `sandbox.stop()` it when idle
  instead of deleting it.
- **Import location** — this skill imports `BuiltInAgent` / `defineTool` from `@copilotkit/runtime/v2`
  (published `@copilotkit/runtime`). If the existing app imports them from a different entry point, match the
  app's existing import.
- **"AI SDK Warning: System messages in the prompt or messages fields…"** — this is emitted by the Vercel
  AI SDK from _inside_ CopilotKit's runtime (it passes a system message via `messages` rather than the
  SDK's `system` option). It is **benign** and unrelated to the Daytona tool — there is no `BuiltInAgent`
  knob (no `allowSystemInMessages` / `system` passthrough) to silence it from here, so don't change the tool
  to chase it. The fix belongs in the CopilotKit runtime; removing the agent's `prompt` does not reliably
  stop it and only degrades behavior.
- **Keeping current** — treat [references/daytona-sandboxes.md](references/daytona-sandboxes.md) as a
  pointer to Daytona's maintained sources (`llms.txt`, the dashboard limits page, the official `daytona`
  skill, and the Daytona MCP server), not as a frozen copy of the SDK. Verify SDK specifics against those
  before relying on them.

## Quick reference

| Need                                 | Call                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Run Python/TS/JS                     | `daytona.create({ language })` → `sandbox.process.codeRun(code)`        |
| Run a shell command / other language | `sandbox.process.executeCommand(cmd)`                                   |
| Expose a server the agent started    | `sandbox.getPreviewLink(port)`                                          |
| Reuse a sandbox                      | create once, `sandbox.stop()` / `sandbox.start()` instead of `delete()` |
| Preinstall a toolchain               | create from a custom `Image` / snapshot                                 |
