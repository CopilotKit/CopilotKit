---
"@copilotkit/channels-core": minor
"@copilotkit/channels-intelligence": minor
"@copilotkit/channels-ui": minor
"@copilotkit/channels": minor
---

feat(channels): one Channel can register many named agents

`createChannel({ agent, agents })` keeps `agent` as the default. `thread.runAgent({ agentId })` runs one named agent per call. Extra agents get their own checkpoint id and Intelligence wire id. Chat history stays shared.
