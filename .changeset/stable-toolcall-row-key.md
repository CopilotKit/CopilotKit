---
"@copilotkit/react-core": patch
---

fix: key tool-call message rows by their stable tool-call id to prevent remount flash

Some backends re-key a message mid-stream: the transient streaming id (e.g. LangChain's `lc_run--…`) is replaced by the provider's final id (`resp_…`) in the `MESSAGES_SNAPSHOT`. Because `CopilotChatMessageView` keyed rows by `message.id`, that swap unmounted and remounted the row — a visible flash, most noticeably the human-in-the-loop tool card flickering during a tool's `executing → complete` transition. Assistant rows that carry tool calls are now keyed by their first tool-call id (which survives the rename), so React reconciles the row in place. Messages without tool calls keep `id` keying, unchanged. Limitations: backends that re-key tool-call ids mid-stream still remount, and when two distinct assistant messages share a first tool-call id the first occurrence keeps the stable key while later ones fall back to id keying.
