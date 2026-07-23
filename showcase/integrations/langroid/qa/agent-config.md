# QA: Agent Config Object — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend reachable at `/api/copilotkit-agent-config`
- Langroid agent server running (see `/api/health`)

## Test Steps

### 1. Config UI

- [ ] Navigate to `/demos/agent-config`
- [ ] Verify `data-testid="agent-config-card"` is visible
- [ ] Verify Tone / Expertise / Response length selects are rendered

### 2. Forwarded properties reach the agent

- [ ] Change Tone to "enthusiastic"
- [ ] Send "Hello" and verify a response is produced; tone should read as noticeably upbeat/warm
- [ ] Change Expertise to "expert" and Response length to "detailed"
- [ ] Send "Explain how LLM tool calling works" — verify the response uses domain terminology freely and is multiple sentences (not 1 to 2)
- [ ] Change Response length to "concise" and Expertise to "beginner"
- [ ] Send the same question — response should be 1 to 2 sentences, avoid jargon, and define any technical term the first time it appears

### 3. Network inspection (optional, deeper verification)

- [ ] Open DevTools Network panel
- [ ] Send a message and inspect the POST to `/api/copilotkit-agent-config`
- [ ] In the request body, verify `forwardedProps.config.configurable.properties`
      contains `tone`, `expertise`, and `responseLength` with the selected values
- [ ] The flat keys `forwardedProps.tone` / `.expertise` / `.responseLength`
      should NOT be present — the route repacks them under `config.configurable.properties`

## Expected Results

- Selecting different config values visibly changes the assistant's voice,
  depth of explanation, and response length.
- The `/api/copilotkit-agent-config` request body shows the repacked shape
  (flat provider keys land under `forwardedProps.config.configurable.properties`).
- The Langroid backend receives the properties (via AG-UI `forwarded_props`)
  and appends style directives to its system prompt for that run only; other
  demos remain unaffected.
