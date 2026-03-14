---
"@copilotkitnext/core": patch
---

fix: handle empty tool arguments without crashing — treat empty/null/undefined args as `{}` instead of throwing JSON parse error
