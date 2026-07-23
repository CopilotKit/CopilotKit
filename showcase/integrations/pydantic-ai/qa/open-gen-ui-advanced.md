# QA: Open Generative UI (Advanced) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `OPENAI_API_KEY` set so the PydanticAI agent can reach gpt-4.1

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/open-gen-ui-advanced`
- [ ] Verify the chat interface loads and suggestion pills render

### 2. Sandbox -> Host Round-Trip

- [ ] Click the "Calculator (calls evaluateExpression)" suggestion
- [ ] Wait for the sandboxed iframe to mount with a calculator UI
- [ ] Enter an arithmetic expression (e.g. `12 * 3`) and press `=`
- [ ] Verify the result appears in the display (round-trip through the
      host `evaluateExpression` sandbox function)

### 3. Ping host

- [ ] Click the "Ping the host (calls notifyHost)" suggestion
- [ ] Click the generated "Say hi to the host" button
- [ ] Verify a confirmation object (with a timestamp) appears inside the card
- [ ] Verify the DevTools console logs `[open-gen-ui/advanced] notifyHost: …`

### 4. Error Handling

- [ ] Verify no console errors during normal usage
- [ ] Verify the iframe is sandboxed (element inspection: `sandbox="allow-scripts"`)

## Expected Results

- Runtime `openGenerativeUI` is enabled on this endpoint and the agent
  streams a `generateSandboxedUi` tool call per turn
- Generated UIs invoke host sandbox functions via
  `Websandbox.connection.remote.*` and render the results in the iframe
