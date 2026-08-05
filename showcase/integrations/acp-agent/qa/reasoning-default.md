# QA: Reasoning: Default — ACP Agent via Intelligence

## Prerequisites

- Intelligence has the ACP feature enabled for the project
- The ACP profile emits `agent_thought_chunk` updates
- `/api/health` reports `agent: ok`

## Test Steps

### 1. Reasoning lifecycle

- [ ] Open `/demos/reasoning-default`
- [ ] Choose `Show reasoning`
- [ ] Confirm the built-in reasoning row appears before final text
- [ ] Expand the row and confirm the thought text is present

### 2. Completion

- [ ] Confirm the reasoning row closes when final text starts
- [ ] Confirm the run ends without an open loading state
