# QA: Open-Ended Generative UI — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (served via /api/copilotkit-ogui)

## Test Steps

- [ ] Navigate to /demos/open-gen-ui
- [ ] Click the "3D axis visualization" suggestion
- [ ] Verify the runtime's `generateSandboxedUi` tool is called and an `open-generative-ui` activity is emitted
- [ ] Verify the built-in `OpenGenerativeUIActivityRenderer` mounts the sandboxed iframe
- [ ] Verify the visualization renders as described in the suggestion
- [ ] Verify no console errors

## Expected Results

- Agent-authored HTML / CSS renders inside a sandboxed iframe
- No UI errors
