# QA: Agent Config — Spring AI

## Prerequisites

- Spring AI backend is up with the AgentConfigController mounted at `/agent-config/run`

## Test Steps

- [ ] Navigate to `/demos/agent-config`
- [ ] Change Tone to "enthusiastic", Expertise to "beginner", Response length to "detailed"
- [ ] Ask "Explain how a database index works"
- [ ] Verify the response is enthusiastic, beginner-friendly, and multi-paragraph
- [ ] Switch Tone to "professional" and Response length to "concise"
- [ ] Ask the same question
- [ ] Verify the response is neutral, precise, and 1-3 sentences

## Expected Results

- The forwarded `tone` / `expertise` / `responseLength` props drive the system prompt composition on the Spring side
