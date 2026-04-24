# QA: Agent Config Object — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend reachable at `/api/copilotkit-agent-config`

## Test Steps

### 1. Config UI

- [ ] Navigate to `/demos/agent-config`
- [ ] Verify `data-testid="agent-config-card"` is visible
- [ ] Verify Tone / Expertise / Response length selects are rendered
- [ ] Change Tone to "enthusiastic"
- [ ] Send "Hello" and verify a response is produced
- [ ] Change Expertise to "expert" and Response length to "detailed"
- [ ] Send another message and confirm the agent continues to respond

Note: the Langroid agent backend does not yet consume forwarded `properties`
to steer its system prompt. The provider + route carry them end-to-end;
wiring the Langroid ChatAgent to read them is tracked in PARITY_NOTES.md.
