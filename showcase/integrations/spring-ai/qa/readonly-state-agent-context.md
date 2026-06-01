# QA: Readonly State / Agent Context — Spring AI

## Prerequisites

- Demo is deployed and accessible

## Test Steps

- [ ] Navigate to `/demos/readonly-state-agent-context`
- [ ] Verify the context card renders with Name, Timezone, Recent Activity
- [ ] Ask "What do you know about me?"
- [ ] Verify the agent reflects the context values (name, timezone, activities)
- [ ] Toggle an activity checkbox
- [ ] Ask again and verify the agent sees the updated context

## Expected Results

- The agent receives the latest frontend context via useAgentContext
