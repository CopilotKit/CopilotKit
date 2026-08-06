# QA: Pre-Built: CopilotChat — ACP Agent via Intelligence

## Prerequisites

- Intelligence has the ACP feature enabled for the project
- An external ACP relay is online with the configured runtime and agent ids
- `COPILOTKIT_ACP_CWD` is a non-secret selector the external agent accepts
- `/api/health` reports `agent: ok` for Intelligence admission; it does not probe the external relay
- For local dev, `npm run relay` is running in a second terminal

## Test Steps

### 1. Durable chat

- [ ] Open `/demos/agentic-chat`
- [ ] Send `Write a short sonnet about AI.`
- [ ] Confirm text streams into one assistant message
- [ ] Reload and confirm the external agent loads the stored ACP session for a second run

### 2. Cancellation

- [ ] Start a long prompt
- [ ] Stop it while text is streaming
- [ ] Confirm no later text appears for that run

### 3. Permission limit

- [ ] Trigger a permission request and resolve it without restarting the Showcase server
- [ ] Confirm the agent continues in the same live server process
- [ ] Do not use this flow to test cross-replica or serverless resume

### 4. Deployment smoke route

- [ ] Open `/api/smoke`
- [ ] Confirm it reports `status: ok`
- [ ] Confirm the check follows the returned Gateway topic through `RUN_FINISHED`
- [ ] Stop the external relay and confirm `/api/smoke` reports an error
