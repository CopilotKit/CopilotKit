---
"@copilotkit/core": patch
"@copilotkit/angular": patch
---

fix(core): notify subscribers when agent threads change

Notify framework subscribers when an observed agent changes threads and clear Angular interrupts retained from the previous thread.
