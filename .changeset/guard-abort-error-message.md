---
"@copilotkit/runtime-client-gql": patch
---

fix(runtime-client-gql): guard abort errors without message

Prevent early-stop abort handling from throwing when the abort cause does not expose a string message.
