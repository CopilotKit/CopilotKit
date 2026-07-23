# QA: Open-Ended Generative UI (Advanced) — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (served via /api/copilotkit-ogui)

## Test Steps

- [ ] Navigate to /demos/open-gen-ui-advanced
- [ ] Issue a prompt that exercises a sandbox function (see `suggestions.ts`)
- [ ] Verify the generated iframe can invoke the page-provided `sandboxFunctions`
- [ ] Verify the host page reacts to the sandboxed call
- [ ] Verify no console errors

## Expected Results

- Host <-> sandbox function bridge works end-to-end
- No UI errors
