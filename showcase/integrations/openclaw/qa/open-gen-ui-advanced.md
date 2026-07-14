# QA: Open-Ended Generative UI (Advanced) — OpenClaw

Demo source: `src/app/demos/open-gen-ui-advanced/page.tsx`
Route: `/demos/open-gen-ui-advanced` · Agent: `open-gen-ui-advanced`
Runtime: `/api/copilotkit-ogui` (dedicated OGUI runtime; see `route.ts`)
Run against the real backend at `http://localhost:3119/demos/open-gen-ui-advanced`.

Status: **supported** (pass-through + runtime middleware). The `open-gen-ui`
family relies on the runtime's `OpenGenerativeUIMiddleware`, not a per-demo
backend graph. It has not been individually e2e-verified at the gateway level
(see `PARITY_NOTES.md`), but rides the same proven pass-through/client-tools
mechanisms as `frontend-tools`.

## What it exercises

The agent streams a single `generateSandboxedUi` tool call. The tool is
**injected by the runtime**, not the frontend — enabling
`openGenerativeUI: { agents: ["open-gen-ui-advanced"] }` in
`api/copilotkit-ogui/route.ts` adds it to the tool list and installs
`OpenGenerativeUIMiddleware`. OpenClaw is a stateless pass-through gateway: the
ag-ui adapter forwards the injected tool as a caller-provided **client tool**
(`runtime.agent.runEmbeddedAgent({ clientTools })`) and relays the model's
`TOOL_CALL_*` events back. The middleware converts that stream into
`open-generative-ui` activity events, and the built-in
`OpenGenerativeUIActivityRenderer` (activated by passing `openGenerativeUI` to
`<CopilotKit>`) mounts the agent-authored HTML/CSS inside a **sandboxed iframe**.

The "advanced" part is a two-way bridge: `openGenUiSandboxFunctions`
(`sandbox-functions.ts`) are passed on the provider's
`openGenerativeUI={{ sandboxFunctions }}` prop and become host-side callables the
in-iframe UI invokes via `Websandbox.connection.remote.<name>(args)`:

- `evaluateExpression({ expression })` — arithmetic-only eval on the host,
  returns `{ ok: true, value }` or `{ ok: false, error }`.
- `notifyHost({ message })` — logs on the host, returns
  `{ ok: true, receivedAt, message }`.

Their names/descriptions/Zod schemas are injected into the agent context so the
model knows which bridges exist when it authors the UI.

## Prerequisites

- Stack is up; demo reachable at the URL above; `/api/health` green.
- Gateway is healthy (all per-demo agent names map to the one OpenClaw endpoint).
- OGUI runtime wired: `openGenerativeUI.agents` includes `"open-gen-ui-advanced"`.
- Sandbox handlers exported: `evaluateExpression` and `notifyHost`.

## Manual steps

1. Open the demo. Confirm `<CopilotChat>` renders full-height inside the centered
   `max-w-4xl` container and the composer is visible.
2. Confirm the three suggestion chips are shown (always available):
   **Calculator**, **Ping the host**, **Inline expression evaluator**.
3. Click **Calculator (calls evaluateExpression)**. Expect the agent to stream a
   `generateSandboxedUi` call and a sandboxed iframe to mount with a calculator
   UI (digit + operator buttons, a display, an `=` button; all buttons
   `type="button"`, no `<form>`).
4. Open browser devtools console. Build `12 * (3 + 4.5)` and press `=`.
   Expect the host console to log
   `[open-gen-ui/advanced] evaluateExpression 12 * (3 + 4.5) = 90` and the
   display to show `90` (the `res.value` returned from the host).
5. Click **Ping the host (calls notifyHost)**. Expect an iframe card with a
   single button; clicking it logs `[open-gen-ui/advanced] notifyHost: <msg>`
   and the card renders the returned `{ ok, receivedAt, message }` (ISO-8601
   timestamp + echoed message).
6. Click **Inline expression evaluator**. Enter `2 + 2`, evaluate → output `4`.
   Enter `abc + 1` → output the error string
   (`"Unsupported characters in expression."`).

## Assertion bar

- Exactly one `generateSandboxedUi` tool-call sequence per request, mounted as a
  sandboxed iframe in the assistant turn.
- The sandbox → host round-trip (button → `Websandbox.connection.remote.<fn>` →
  visible result) completes with no page reload.
- `evaluateExpression` returns `{ ok, value }` on valid input and
  `{ ok: false, error }` on rejected/non-finite input; `notifyHost` returns
  `{ ok: true, receivedAt, message }`.
- No console errors beyond the two intentional `console.log` lines from the
  sandbox handlers.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` (carrying the injected
`generateSandboxedUi` tool) to
`http://127.0.0.1:8000/v1/ag-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) and confirm the SSE contains a single
`TOOL_CALL_START` for `generateSandboxedUi`, followed by `RUN_FINISHED`.

## Caveats

- Behaviour comes from the **runtime middleware + frontend**, not a per-demo
  OpenClaw graph. The gateway only forwards the injected tool and relays events;
  the sandboxed-UI conversion and iframe mounting are entirely runtime/frontend.
- The OGUI demos use a **dedicated runtime** (`/api/copilotkit-ogui`) because the
  `openGenerativeUI` flag globally sets `openGenerativeUIEnabled` on the probe
  response, which would wipe per-demo `useFrontendTool`/`useComponent`
  registrations in the default runtime.
- `evaluateExpression` rejects anything outside `+ - * / ( ) .` and digits
  (`{ ok: false, error }`) and rejects non-finite results (e.g. `1/0`) — the
  handler never execs arbitrary JS.
- Quality of the generated UI depends on the model behind the gateway; the demo
  does not ship a fixed layout. The `evaluateExpression`/`notifyHost` bridge
  contract is deterministic, but the surrounding HTML the model authors is not.
