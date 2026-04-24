# QA: Open-Ended Generative UI (Advanced) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy
- ANTHROPIC_API_KEY is set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/open-gen-ui-advanced`
- [ ] Click the "Calculator (calls evaluateExpression)" suggestion
- [ ] Verify an iframe renders with a calculator UI (no <form>, only <button type='button'>)

### 2. Sandbox-Function Round-Trip

- [ ] In the calculator, enter "12 * (3 + 4.5)" and press "="
- [ ] Verify the display updates with the host-evaluated result
- [ ] Open devtools console — verify `[open-gen-ui/advanced] evaluateExpression` log appears

### 3. notifyHost

- [ ] Try the "Ping the host (calls notifyHost)" suggestion
- [ ] Click the button in the rendered card
- [ ] Verify `[open-gen-ui/advanced] notifyHost:` log in the host console
- [ ] Verify the card updates with a confirmation showing `receivedAt`

### 4. Error Handling

- [ ] Verify no CORS/CSP errors from the sandbox
- [ ] Verify evaluateExpression rejects non-arithmetic input safely

## Expected Results

- Sandbox -> host calls via Websandbox.connection.remote work end-to-end
- Handler return values are visible inside the iframe UI
