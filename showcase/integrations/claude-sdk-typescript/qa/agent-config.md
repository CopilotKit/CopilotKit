# QA: Agent Config Object — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/agent-config`
- [ ] Verify the three select controls (Tone, Expertise, Response length) render
- [ ] Verify the chat interface loads

### 2. Forwarded props routing

- [ ] With Tone=professional, Expertise=beginner, Length=detailed, send "Explain what a pointer is"
- [ ] Verify Claude responds in multiple paragraphs with analogies / no jargon
- [ ] Switch Tone=casual, Expertise=expert, Length=concise
- [ ] Send "Same question"
- [ ] Verify the reply shifts tone and shortens dramatically

### 3. Defaults

- [ ] Reload the page — settings reset to professional / intermediate / concise
- [ ] Verify responses follow defaults when forwarded props are absent

## Expected Results

- Chat loads within 3 seconds
- Claude adapts observable tone/length across settings
- `forwardedProps` is threaded into the agent's system prompt every turn
