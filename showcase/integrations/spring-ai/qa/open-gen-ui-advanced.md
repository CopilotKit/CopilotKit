# QA: Open-Ended Generative UI (Advanced) — Spring AI

## Prerequisites

- Demo is deployed and accessible
- OPENAI_API_KEY is set on the Spring backend

## Test Steps

- [ ] Navigate to `/demos/open-gen-ui-advanced`
- [ ] Click the "Calculator (calls evaluateExpression)" suggestion
- [ ] Verify a calculator UI appears inside a sandboxed iframe
- [ ] Type `12 * (3 + 4.5)`, press `=`
- [ ] Verify the host-side `evaluateExpression` runs and the sandbox displays `94.5`
- [ ] Check browser console for `[open-gen-ui/advanced] evaluateExpression`

## Expected Results

- Sandbox function round-trips complete end-to-end
- Console logs confirm host invocation
