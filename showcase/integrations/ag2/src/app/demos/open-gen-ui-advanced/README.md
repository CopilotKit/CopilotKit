# Open Generative UI (Advanced)

## What This Demo Shows

Builds on the minimal Open Generative UI cell with **sandbox-function
calling**: the agent-authored, sandboxed UI invokes host-page functions
via `await Websandbox.connection.remote.<name>(args)` from inside the
iframe. The host functions (see `./sandbox-functions.ts`) run on the
host page and return values back into the sandbox.

## How to Interact

- "Build a modern calculator UI." (calls `evaluateExpression`)
- "Build a card with a 'Say hi to the host' button." (calls `notifyHost`)
- "Build an inline expression evaluator." (calls `evaluateExpression`)

## Technical Details

- Sandbox functions: `./sandbox-functions.ts`. Names, descriptions, and
  Zod-derived JSON schemas are injected into agent context so the LLM
  knows what bridges exist when it generates HTML/JS.
- Provider: `<CopilotKit openGenerativeUI={{ sandboxFunctions }}>` wires
  each entry as a `localApi` method on the in-iframe websandbox
  connection.
- Backend agent: `src/agents/open_gen_ui_advanced_agent.py` — no tools.
  The system prompt stresses sandbox-iframe restrictions (no `<form>`,
  no `type="submit"`, no fetch/XHR/localStorage).
- Runtime route: shared with the minimal cell at
  `src/app/api/copilotkit-ogui/route.ts`.

## Reference

- https://docs.copilotkit.ai/generative-ui/open-generative-ui
