# QA: Agent Config Object demo — LlamaIndex

## Prerequisites

- Demo is deployed and accessible

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the agent-config demo page
- [ ] Verify the chat interface and config card are visible
- [ ] Change one axis (tone/expertise/length)
- [ ] Send a message and observe the response style

### 2. Config Forwarding

- [ ] Open the network inspector
- [ ] Send a message and confirm `configurable.properties` is in the request body

## Note

The LlamaIndex backend currently applies a static default profile. Dynamic
per-turn config forwarding requires a custom Workflow (tracked in
PARITY_NOTES).
