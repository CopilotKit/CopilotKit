---
"@copilotkit/runtime": patch
---

- Revert "fixes paths defined in readact (#1133)"

This reverts commit 8d7992d32c56e9467d3791ac5f0572d8843e9700.
- removes redact from pino as it breaks in cloudflare
