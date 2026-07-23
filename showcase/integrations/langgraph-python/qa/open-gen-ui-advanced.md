# QA: Open-Ended Generative UI (Advanced) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- Graph `open_gen_ui_advanced` is registered in the OGUI runtime (`api/copilotkit-ogui/route.ts`) with `openGenerativeUI.agents` including `"open-gen-ui-advanced"`
- Sandbox-function handlers in `sandbox-functions.ts` are exported: `evaluateExpression` and `notifyHost`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the open-gen-ui-advanced demo page
- [ ] Verify the `<CopilotChat>` renders full-height within the centered max-w-4xl container
- [ ] Verify the input composer is visible
- [ ] Send a basic message (e.g. "Hi")
- [ ] Verify the agent calls `generateSandboxedUi` and a sandboxed iframe mounts in the assistant turn

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Calculator (calls evaluateExpression)" suggestion is visible
- [ ] Verify "Ping the host (calls notifyHost)" suggestion is visible
- [ ] Verify "Inline expression evaluator" suggestion is visible

#### Sandbox-to-Host: evaluateExpression (Calculator)

- [ ] Click the "Calculator (calls evaluateExpression)" suggestion
- [ ] Verify a sandboxed iframe renders a calculator UI with digit buttons, operator buttons, a display, and an "=" button
- [ ] Verify all buttons use `type="button"` — no `<form>` element is present inside the iframe
- [ ] Enter an expression like `12 * (3 + 4.5)` via the calculator buttons (or the generated input)
- [ ] Open browser devtools console BEFORE pressing "="
- [ ] Press "="
- [ ] Verify the host console logs `[open-gen-ui/advanced] evaluateExpression 12 * (3 + 4.5) = 90`
- [ ] Verify the display updates to show `90` (the `res.value` returned by the host)
- [ ] Verify a computed-history entry appears below the display
- [ ] In a follow-up user turn, type "What was the result of my last calculation?" and verify the agent's text response references the computed value (round-trip: sandbox call -> host handler -> visible result -> agent awareness via subsequent turn context)

#### Sandbox-to-Host: notifyHost (Ping)

- [ ] In a new turn, click the "Ping the host (calls notifyHost)" suggestion
- [ ] Verify a sandboxed iframe renders a card with a single "Say hi to the host" button
- [ ] Open the browser devtools console
- [ ] Click the button
- [ ] Verify the host console logs `[open-gen-ui/advanced] notifyHost: Hi from the sandbox!`
- [ ] Verify the card updates to display the returned confirmation object, including a `receivedAt` ISO-8601 timestamp and the echoed `message` field

#### Sandbox-to-Host: Inline Expression Evaluator

- [ ] In a new turn, click the "Inline expression evaluator" suggestion
- [ ] Verify a sandboxed iframe renders a text input + "Evaluate" button (no `<form>`, button `type="button"`)
- [ ] Enter `2 + 2` and click "Evaluate"
- [ ] Verify the output area renders `4` (from `res.value`)
- [ ] Enter an invalid expression `abc + 1` and click "Evaluate"
- [ ] Verify the output area renders the error string from `res.error` (e.g. "Unsupported characters in expression.")

#### Sandbox Constraints

- [ ] Verify the iframe sandbox attribute is `sandbox="allow-scripts"` only (no `allow-forms`, no `allow-same-origin`)
- [ ] Verify no network requests originate from the iframe (check DevTools Network filtered by iframe frame)
- [ ] Verify the agent keeps its own chat message brief (1 sentence) — the rendered UI is the real output

### 3. Error Handling

- [ ] Enter an expression with unsupported characters (e.g. `alert(1)`) into the calculator/evaluator and confirm `res.ok === false` with error "Unsupported characters in expression."
- [ ] Enter a divide-by-zero (`1/0`) — verify the handler returns `{ ok: false, error: "Not a finite number." }` and the UI renders the error path
- [ ] Refresh the page mid-stream — verify no broken UI persists
- [ ] Send an empty message — input should be rejected without error
- [ ] Verify no console errors beyond the two intentional `console.log` statements from the sandbox-function handlers

## Expected Results

- Chat loads within 3 seconds
- First interactive sandboxed UI mounts within ~15 seconds of prompt submission
- Sandbox -> host round-trip (button click -> `Websandbox.connection.remote.<fn>` -> visible result) completes without page reload
- `evaluateExpression` returns `{ ok, value }` on valid input and `{ ok: false, error }` on rejected input
- `notifyHost` returns `{ ok: true, receivedAt, message }` with a valid ISO-8601 timestamp
- No UI errors or broken layouts
