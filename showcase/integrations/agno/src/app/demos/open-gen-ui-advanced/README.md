# Open Generative UI (Advanced)

## What This Demo Shows

Open Generative UI with **host-side sandbox functions**. The agent-authored
sandboxed iframe can call back into the host page via
`Websandbox.connection.remote.<name>(args)` — every callable is
declared frontend-side via `openGenerativeUI.sandboxFunctions`.

## How to Interact

Try the "Calculator" or "Inline expression evaluator" suggestion — the
sandboxed UI calls `evaluateExpression` on the host page and renders the
returned result.

## Technical Details

- `sandbox-functions.ts` declares `evaluateExpression` and `notifyHost`
  with Zod schemas; the schemas are injected into the agent's context so
  the LLM knows the bridges exist.
- The runtime route is shared with `/demos/open-gen-ui` — the only
  differences live on the frontend (`openGenerativeUI.sandboxFunctions`).
