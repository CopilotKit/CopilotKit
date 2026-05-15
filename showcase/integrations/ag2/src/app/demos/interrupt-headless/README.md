# interrupt-headless — Not Supported on AG2

## Status

Marked `not_supported_features` in `manifest.yaml`. The page renders an
explanation with links to the supported alternatives (`hitl-in-app`,
`frontend-tools-async`).

## Why

This demo is a headless variant of `gen-ui-interrupt`: the host page
subscribes to the AG-UI stream, listens for a LangGraph
`interrupt()` event, and resumes the **same run** from a persisted
checkpoint via
`copilotkit.runAgent({ forwardedProps: { command: { resume } } })`.

AG2's `ConversableAgent` does not pause-and-resume the same run from a
persisted checkpoint, so the resumable interrupt round-trip cannot be
reproduced — and consequently the headless resume contract this demo
relies on cannot either.

## Supported alternatives on AG2

- **`hitl-in-app`** — out-of-chat approval surface via `useFrontendTool`
  with an async handler. Same UX shape (modal popup outside the chat,
  click resolves the pending tool call), different mechanism.
- **`frontend-tools-async`** — minimal async-handler example showing
  the same Promise-resolve pattern without the popup surface.

## Reference

- AG2 `human_input_mode`: https://docs.ag2.ai/docs/api-reference/autogen/ConversableAgent
- CopilotKit HITL docs: https://docs.copilotkit.ai/human-in-the-loop
