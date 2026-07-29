---
"@copilotkit/channels-intelligence": minor
---

Send managed Channel render output as bounded, ordered batches. The first text
flushes at once, later text compacts for up to 250 milliseconds, semantic
events keep their order, and retries reuse the same batch identifier and
content digest.
