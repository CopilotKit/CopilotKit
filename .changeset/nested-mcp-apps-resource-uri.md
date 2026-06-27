---
"@copilotkit/runtime": patch
---

fix(runtime): recognize nested MCP Apps resource metadata

FastMCP Prefab app tools using `_meta.ui.resourceUri` now produce MCP Apps activities with their structured tool result preserved for the iframe renderer.
