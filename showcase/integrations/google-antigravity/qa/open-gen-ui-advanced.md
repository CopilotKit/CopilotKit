# QA: Open-Ended Generative UI (Advanced) — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/open-gen-ui-advanced` on the dashboard host
- Agent backend is healthy (`/api/health`); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests)
- The agent server mounts `open_gen_ui_advanced_agent()` (`src/agents/open_gen_ui_advanced.py`) at `/open_gen_ui_advanced` (registry name `open_gen_ui_advanced`); the OGUI runtime (`src/app/api/copilotkit-ogui/route.ts`) maps agent name `open-gen-ui-advanced` to it, with `openGenerativeUI.agents` including `"open-gen-ui-advanced"`
- How it works: the runtime's `openGenerativeUI` config makes the provider register the `generateSandboxedUi` frontend tool, which the adapter hands to the model like any other client tool; the OpenGenerativeUI middleware mounts the call's HTML in a sandboxed iframe. The page passes `openGenerativeUI.sandboxFunctions` (`evaluateExpression`, `notifyHost`, from `sandbox-functions.ts`). Their descriptors reach the agent as app context, which the model can read with the adapter's silent built-in `get_app_context` tool (opted into with `experimental_app_context=True`), and they are also written into the agent's system prompt with their exact return shapes.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/open-gen-ui-advanced`
- [ ] Verify the `<CopilotChat>` renders full height within the centered max-w-4xl container
- [ ] Verify the input composer is visible
- [ ] Send a basic message (e.g. "Hi")
- [ ] Verify the agent calls `generateSandboxedUi` and a sandboxed iframe mounts in the assistant turn

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify three suggestion pills with titles "Calculator", "Ping the host", "Inline expression evaluator"
- [ ] Verify they send "Calculator (calls evaluateExpression)", "Ping the host (calls notifyHost)" and "Inline expression evaluator" respectively

#### Sandbox-to-Host: evaluateExpression (Calculator)

- [ ] Click "Calculator"
- [ ] Verify a sandboxed iframe renders a calculator UI with digit buttons, operator buttons, a display, and an "=" button
- [ ] Verify the buttons use `type="button"` — no `<form>` element inside the iframe
- [ ] Open the browser DevTools console BEFORE pressing "="
- [ ] Enter an expression like `12 * (3 + 4.5)` via the calculator buttons (or the generated input) and press "="
- [ ] Verify the host console logs `[open-gen-ui/advanced] evaluateExpression 12 * (3 + 4.5) = 90`
- [ ] Verify the display updates to show `90` (the `res.value` returned by the host)

#### Sandbox-to-Host: notifyHost (Ping)

- [ ] In a new turn, click "Ping the host"
- [ ] Verify a sandboxed iframe renders a card with a button that pings the host
- [ ] With the DevTools console open, click the button
- [ ] Verify the host console logs `[open-gen-ui/advanced] notifyHost: <message>`
- [ ] Verify the card updates to show the returned confirmation, including a `receivedAt` ISO-8601 timestamp and the echoed `message`

#### Sandbox-to-Host: Inline Expression Evaluator

- [ ] In a new turn, click "Inline expression evaluator"
- [ ] Verify a sandboxed iframe renders a text input and an evaluate button (no `<form>`, button `type="button"`)
- [ ] Enter `2 + 2` and click the button; verify the output shows `4` (from `res.value`)
- [ ] Enter `abc + 1` and click the button; verify the output shows the `res.error` string "Unsupported characters in expression."

#### Sandbox Constraints

- [ ] Verify the iframe sandbox attribute is `sandbox="allow-scripts"` only (no `allow-forms`, no `allow-same-origin`)
- [ ] Verify no network requests originate from the iframe (DevTools → Network, filtered by the iframe's frame), apart from CDN script tags the generated HTML may load
- [ ] Verify the agent keeps its own chat message brief (1 sentence) — the rendered UI is the real output
- [ ] Verify no tool card appears for any `get_app_context` read

### 3. Error Handling

- [ ] Enter an expression with unsupported characters (e.g. `alert(1)`) into the calculator or evaluator; confirm the handler returns `{ ok: false, error: "Unsupported characters in expression." }` and the UI shows the error
- [ ] Enter `1/0`; verify the handler returns `{ ok: false, error: "Not a finite number." }` and the UI shows the error path
- [ ] Refresh the page mid-stream; verify no broken UI persists
- [ ] Send an empty message; verify it is rejected without error
- [ ] Verify no console errors beyond the intentional `console.log` lines from the sandbox-function handlers

## Expected Results

- Chat loads within 3 seconds
- The first interactive sandboxed UI mounts within ~15 seconds of the prompt
- Sandbox → host round-trip (button click → `Websandbox.connection.remote.<fn>` → visible result) completes without a page reload
- `evaluateExpression` returns `{ ok: true, value }` on valid input and `{ ok: false, error }` on rejected input
- `notifyHost` returns `{ ok: true, receivedAt, message }` with a valid ISO-8601 timestamp
- No UI errors or broken layouts
