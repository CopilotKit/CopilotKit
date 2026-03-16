---
"@copilotkitnext/agent": patch
---

fix: detect default provider message IDs to prevent collisions — generate deterministic IDs when the provider returns default/sequential IDs that could collide across sessions
