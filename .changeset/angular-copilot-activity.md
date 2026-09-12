---
"@copilotkit/angular": minor
---

feat(angular): add `CopilotActivity`, a standalone host for a single activity message. `CopilotChatMessageView` now delegates activity rendering to it, so custom chat shells and non-chat surfaces can render activities through the registered renderers without instantiating the message view.
