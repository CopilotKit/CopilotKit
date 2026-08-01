---
"@copilotkit/react-core": minor
"@copilotkit/react-native": minor
"@copilotkit/runtime-client-gql": patch
---

feat(react-core): accept async header builders across request consumers

Resolve asynchronous headers before initial and child requests across React providers, preserve explicit cloud-key headers, and retain the last-good record during refresh failures.
