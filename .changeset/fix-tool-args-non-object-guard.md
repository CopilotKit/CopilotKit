---
"@copilotkit/runtime": patch
"@copilotkit/runtime-client-gql": patch
"@copilotkitnext/core": patch
"@copilotkitnext/agent": patch
---

fix: guard against non-object tool arguments from LLMs

LLMs may occasionally return non-object values (e.g. empty string `""`) as
tool call arguments. When these invalid arguments are stored in conversation
history and re-sent, providers like Anthropic reject the request with a 400
error ("Input should be a valid dictionary").

Added validation that parsed tool arguments are always a plain object, falling
back to `{}` when the LLM returns strings, numbers, arrays, or null. This
prevents permanently broken conversations caused by a single malformed tool
call.

Fixes #3300
