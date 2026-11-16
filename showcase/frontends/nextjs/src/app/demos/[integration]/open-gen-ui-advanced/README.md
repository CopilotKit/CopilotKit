# Open Generative UI (Advanced)

## What This Demo Shows

The agent writes an interactive HTML, CSS and JavaScript app in a sandboxed iframe, and that app calls functions on the host page. For example, a calculator in the iframe asks the host page to evaluate the expression.

## How to Interact

Click a suggestion:

- **Calculator**: the calculator calls `evaluateExpression` on the host page and shows the result.
- **Ping the host**: a button sends a message to the host page with `notifyHost`, then shows the reply.
- **Inline expression evaluator**: a text input and a button that call `evaluateExpression`.

## Technical Details

- `sandbox-functions.ts` defines the host-side functions. Each one has a name, a description, a Zod schema and a handler. The provider adds their descriptions to the agent context, so the model knows which functions exist.
- `openGenerativeUI={{ sandboxFunctions }}` on `CopilotKit` makes the handlers callable inside the iframe. The generated code calls them with `await Websandbox.connection.remote.<name>(args)`.
- The runtime options of this demo turn on Open Generative UI for the `open-gen-ui-advanced` agent (see `src/demo-runtime-options.ts`).
- `page.tsx` is a server component. It loads the settings of the integration for this demo, and gives them to the client component in `demo.tsx`.
- Some agents have no system prompt that makes them call `generateSandboxedUi`. Their integration sets `instructToolCall: true` in `src/integrations/<slug>/demos/open-gen-ui-advanced.ts`. The page then passes `TOOL_CALL_DESIGN_SKILL` from `design-skill.ts` as the design skill.

For a visualisation that runs without host functions, see the `open-gen-ui` demo.

Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
