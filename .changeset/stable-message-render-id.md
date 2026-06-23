---
"@copilotkit/react-core": patch
---

fix: key chat message rows by stable renderId to prevent remount flash

When a message's canonical id changes mid-stream (a transient streaming/run id replaced by a provider's final response id), `CopilotChatMessageView` remounted the row — causing a visible flash, most noticeably the human-in-the-loop tool card flickering / the chat appearing to reset during a tool's `executing → complete` transition. Rows are now keyed by `renderId ?? id` so React reconciles the row in place instead of remounting it. Requires `@ag-ui/client` with the `renderId` field.
