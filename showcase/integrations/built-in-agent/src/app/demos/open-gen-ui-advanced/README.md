# Open Generative UI (Advanced)

Open-Ended Generative UI with host-side sandbox functions.

## What it shows

The agent streams a `generateSandboxedUi` tool call. The runtime's
`OpenGenerativeUIMiddleware` (enabled in the dedicated
`/api/copilotkit-ogui` route via `openGenerativeUI: { agents: ["default"] }`)
converts that stream into `open-generative-ui` activity events. The
built-in `OpenGenerativeUIActivityRenderer` mounts the agent-authored
HTML + CSS inside a sandboxed iframe.

The "advanced" twist: the provider passes
`openGenerativeUI.sandboxFunctions` — host-side handlers (defined in
`sandbox-functions.ts`) that are exposed inside the iframe as
`Websandbox.connection.remote.<name>(args)`. The agent-authored UI calls
back into the host page over a postMessage bridge.

## Files

- `page.tsx` — provider setup with `sandboxFunctions`
- `sandbox-functions.ts` — host-side handler array
  (`evaluateExpression`, `notifyHost`)
- `suggestions.ts` — suggestion prompts that explicitly ask the agent to
  call the host functions

## Backend

Reuses the existing OGUI runtime at
`src/app/api/copilotkit-ogui/route.ts`, which is wired to `createOguiAgent`
in `src/lib/factory/ogui-factory.ts` (TanStack AI + `openaiText("gpt-4o")`,
no bespoke tools).
