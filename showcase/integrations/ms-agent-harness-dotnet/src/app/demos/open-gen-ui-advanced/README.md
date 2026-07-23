# Open-Ended Generative UI — Advanced

## What This Demo Shows

A .NET-backed agent that streams interactive HTML + CSS + JS into a sandboxed iframe, and — crucially — the generated UI can call **host-page functions** (a calculator evaluator, a host notifier, etc.) via `Websandbox.connection.remote.<name>(args)`.

## How to Interact

Try one of the preset suggestions:

- **Calculator (calls `evaluateExpression`)** — the agent-authored calculator invokes a host-side arithmetic evaluator and shows the result.
- **Ping the host (calls `notifyHost`)** — a button that sends a message from the sandbox to the host and renders the confirmation.
- **Inline expression evaluator** — a text input + button wired to the host-side evaluator.

## Technical Details

- **Agent**: `OpenGenUiAdvancedAgentFactory` (see `agent/OpenGenUiAdvancedAgent.cs`) — a `ChatClientAgent` whose system prompt teaches the LLM the sandbox-function calling contract and the `allow-scripts`-only iframe restrictions (no `<form>` / `type="submit"`).
- **Sandbox functions** (`sandbox-functions.ts`): the host-side handlers. Each is described with a Zod schema; the provider injects those descriptors into the agent context so the LLM knows which remotes exist.
- **Provider prop**: `openGenerativeUI={{ sandboxFunctions: openGenUiSandboxFunctions }}` on `CopilotKit` wires those handlers as callable remotes inside the iframe via `Websandbox.connection.remote.<name>(args)`.
- **Runtime route**: `src/app/api/copilotkit-ogui/route.ts` enables `openGenerativeUI` for both `open-gen-ui` and `open-gen-ui-advanced` agents.

## Building With This

For the simpler, self-running variant (no host-side bridge), see `open-gen-ui`.

Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
