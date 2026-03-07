---
"@copilotkitnext/agent": patch
---

fix(agent): auto-close reasoning lifecycle when SDK omits reasoning-end

Some AI SDK providers (notably @ai-sdk/anthropic) never emit the "reasoning-end" stream event. This fix adds defensive state tracking to auto-emit REASONING_MESSAGE_END + REASONING_END at phase transitions, preventing the agent from stalling.
