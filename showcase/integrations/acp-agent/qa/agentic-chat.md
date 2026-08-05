# QA: Pre-Built: CopilotChat — ACP Agent via Intelligence

## Prerequisites

- Intelligence has the ACP feature enabled for the project
- `COPILOTKIT_ACP_AGENT_PROFILE_ID` names a trusted server profile
- `/api/health` reports `agent: ok`

## Test Steps

### 1. Durable chat

- [ ] Open `/demos/agentic-chat`
- [ ] Send `Write a short sonnet about AI.`
- [ ] Confirm text streams into one assistant message
- [ ] Reload and confirm the page can start a second run

### 2. Cancellation

- [ ] Start a long prompt
- [ ] Stop it while text is streaming
- [ ] Confirm no later text appears for that run
