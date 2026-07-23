# QA: Agent Config Object — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `ANTHROPIC_API_KEY` is set on the deployment

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/agent-config`
- [ ] Verify the config card renders with three select inputs:
      `agent-config-tone-select`, `agent-config-expertise-select`,
      `agent-config-length-select`
- [ ] Verify the chat surface is visible below the config card

### 2. Feature-Specific Checks

#### Tone

- [ ] Set tone to `professional`, send "Tell me about Paris"
- [ ] Verify Claude's reply avoids emoji and exclamation marks
- [ ] Change tone to `enthusiastic`, send the same prompt
- [ ] Verify the next reply is noticeably more upbeat

#### Expertise

- [ ] Set expertise to `beginner`, ask "Explain quantum entanglement"
- [ ] Verify the reply defines jargon and uses an analogy
- [ ] Switch to `expert` and ask again
- [ ] Verify the reply uses precise terminology and skips basics

#### Response length

- [ ] Set responseLength to `concise` and ask anything open-ended
- [ ] Verify the reply is at most 3 sentences
- [ ] Switch to `detailed`
- [ ] Verify the reply spans multiple paragraphs

### 3. Error Handling

- [ ] Send a message without changing any config first — verify the
      default (professional / intermediate / concise) behaviour holds
- [ ] No console errors during normal usage

## Expected Results

- Config changes take effect on the NEXT message (not retroactively).
- `forwardedProps` reaches the backend via
  `forwarded_props.config.configurable.properties`.
