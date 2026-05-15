# QA: Agent Config Object — PydanticAI

## Prerequisites

- Demo deployed and accessible at `/demos/agent-config`
- Agent backend healthy (check `/api/health`)
- `OPENAI_API_KEY` set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/agent-config`
- [ ] Verify the header "Agent Config Object" is visible
- [ ] Verify the config card renders with three dropdowns (Tone,
      Expertise, Response length)
- [ ] Default values: tone=professional, expertise=intermediate,
      responseLength=concise

### 2. Send with defaults

- [ ] Type "Hello" and send
- [ ] Within 30 seconds, an assistant response renders — tone should be
      neutral/professional, 1-3 sentences

### 3. Switch to casual+beginner+detailed

- [ ] Change tone to "casual", expertise to "beginner", response length
      to "detailed"
- [ ] Type "What is a neural network?" and send
- [ ] Within 30 seconds, an assistant response renders — tone should
      feel conversational, explain jargon with analogies, span multiple
      paragraphs

### 4. Network panel inspection

- [ ] Open DevTools → Network and send a message after selecting
      "enthusiastic"/"expert"/"detailed"
- [ ] Verify the request to `/api/copilotkit-agent-config` includes the
      three values somewhere in its body (they land on the AG-UI
      `context` array the TS route appends)

## PydanticAI-specific note

The TS runtime route subclasses `HttpAgent` to repack the CopilotKit
provider's `properties` into an AG-UI `context` entry tagged
`agent-config-properties`. The Python agent's dynamic
`@agent.system_prompt` reads that entry at call time and composes the
prompt from the three axes. This differs from the langgraph-python
reference (which repacks into `forwardedProps.config.configurable`),
but the user-visible behaviour is identical.

## Expected Results

- Dropdown changes propagate to the next send immediately.
- Tone / expertise / length axes visibly shift the assistant's style.
- Request payloads contain the selected values.
