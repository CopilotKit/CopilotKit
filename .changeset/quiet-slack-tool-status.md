---
"@copilotkit/channels": patch
"@copilotkit/channels-core": patch
"@copilotkit/channels-intelligence": patch
"@copilotkit/channels-slack": patch
"@copilotkit/runtime": patch
---

fix(channels): hide Slack tool-call status by default while preserving direct
`slack({ showToolStatus: true })` and managed
`createChannel({ showToolStatus: true })` opt-ins
