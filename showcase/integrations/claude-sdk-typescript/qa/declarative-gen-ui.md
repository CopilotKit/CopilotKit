# QA: Declarative Generative UI (A2UI) — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (served via /api/copilotkit-declarative-gen-ui)

## Test Steps

- [ ] Navigate to /demos/declarative-gen-ui
- [ ] Send a prompt that asks for a generated card / layout (e.g. a product card or status panel)
- [ ] Verify the runtime injects the `render_a2ui` tool and the agent calls it
- [ ] Verify the client A2UI catalog renders the emitted operations (Card, StatusBadge, Metric, InfoRow, PrimaryButton)
- [ ] Verify no console errors

## Expected Results

- A2UI-rendered surfaces appear inside the chat thread
- No UI errors
