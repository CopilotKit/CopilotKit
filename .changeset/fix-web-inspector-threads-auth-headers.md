---
"@copilotkit/web-inspector": patch
---

fix(web-inspector): propagate auth headers from `CopilotKitProvider` to DevConsole Threads list

The DevConsole Threads list (and the underlying owned thread stores it creates) was initialized with empty headers, so requests it issued to the runtime did not include `Authorization` (or any other) headers configured on the `CopilotKitProvider`. The inspector also did not react to `onHeadersChanged`, so an async auth handshake that updated headers after mount would never reach already-owned stores. Closes #4793.
