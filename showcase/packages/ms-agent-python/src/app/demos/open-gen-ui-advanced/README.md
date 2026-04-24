# Open Generative UI (Advanced)

## What This Demo Shows

Open-ended UI generation — **with** a sandbox -> host bridge. The agent emits a sandboxed iframe whose JavaScript can invoke frontend-registered functions on the host page via `Websandbox.connection.remote.<name>(args)`.

## How to Interact

Try asking your Copilot to:

- "Build a calculator whose `=` button calls `evaluateExpression` and displays the result."
- "Build a card with one 'Say hi to the host' button that calls `notifyHost` and shows the returned confirmation."
- "Build a text input + Evaluate button that calls `evaluateExpression` and renders the result inline."

The agent produces one `generateSandboxedUi` tool call per turn. The generated HTML wires up event listeners that call `Websandbox.connection.remote.<name>(...)`, and the returned value is awaited and rendered inside the sandboxed UI.

## Technical Details

- **`openGenerativeUI: { agents: ["open-gen-ui-advanced"] }`** on the CopilotKit runtime (see `src/app/api/copilotkit-ogui/route.ts`) enables the OGUI pipeline for this agent. Server-side config is identical for the minimal and advanced cells.
- **`openGenerativeUI.sandboxFunctions`** on the CopilotKit provider (see `page.tsx`) — the advanced-only addition. The provider injects a JSON descriptor of every function (name, description, Zod-derived JSON Schema) into the agent's context, and the built-in `OpenGenerativeUIActivityRenderer` wires each entry as a callable method on `Websandbox.connection.remote` inside the iframe.
- **`sandbox-functions.ts`** defines `evaluateExpression` and `notifyHost`. Each handler runs on the host page and returns a plain object; the in-iframe caller awaits it.
- The agent is a thin wrapper around the MS Agent Framework `Agent` with a system prompt tuned to (a) always call `generateSandboxedUi` once per turn, and (b) wire the generated UI to the sandbox functions described in its context. See `src/agents/open_gen_ui_advanced_agent.py`.
- **Sandbox iframe restriction:** the iframe runs with `sandbox="allow-scripts"` only. `<form>` and `<button type="submit">` are blocked — the agent's prompt tells it to use `<button type="button">` + `addEventListener('click', ...)` instead.

## Building With This

Add a new sandbox function by:

1. Append an entry to `openGenUiSandboxFunctions` in `sandbox-functions.ts` (name, description, Zod `parameters`, async `handler`).
2. The descriptor is injected automatically — no agent changes needed. Update your suggestions or the agent prompt if the LLM needs a nudge toward calling it.
