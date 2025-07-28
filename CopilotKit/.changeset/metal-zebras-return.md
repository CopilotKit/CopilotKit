---
"@copilotkit/react-ui": patch
---

- feat(chat): implement custom error handling in CopilotChat and Modal components

- Added `renderError` prop to `CopilotChat` for inline error rendering.
- Introduced `triggerChatError` function to manage chat-specific errors and observability hooks.
- Updated `Modal` to handle observability hooks with public API key checks.
- Enhanced `CopilotObservabilityHooks` interface to include `onError` for error event handling.
