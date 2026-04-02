---
"@copilotkit/react-core": patch
---

Fix multiple CopilotChat components with different threadIds sharing message state. The useAgent hook now creates per-thread agent clones when threadId is provided, ensuring each chat instance maintains isolated messages and state.
