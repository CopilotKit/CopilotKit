# gen-ui-interrupt — Not Supported on AG2

## Status

Marked `not_supported_features` in `manifest.yaml`. The page renders an
explanation with links to the supported alternatives (`hitl-in-chat`,
`hitl-in-app`).

## Why

The LangGraph version of this demo uses `useInterrupt`, which sits on top
of LangGraph's native `interrupt()` primitive:

1. The graph pauses inside a node.
2. The runtime emits a resumable interrupt payload over the AG-UI stream.
3. The frontend renders a custom UI for the payload via the
   `useInterrupt` hook.
4. On user action the frontend resumes the **same run** from a persisted
   checkpoint via
   `copilotkit.runAgent({ forwardedProps: { command: { resume } } })`.

AG2's `human_input_mode` on `ConversableAgent` is a synchronous
request/reply hook. It does not pause-and-resume the same run from a
persisted checkpoint, so the AG-UI resumable-interrupt contract cannot
be reproduced faithfully.

## Supported alternatives on AG2

- **`hitl-in-chat`** — `useHumanInTheLoop` renders an interactive surface
  inline in the chat. Equivalent UX for the common booking / approval /
  pick-a-time case.
- **`hitl-in-app`** — `useFrontendTool` with an async handler renders an
  approval surface OUTSIDE the chat (e.g. an app-level modal).

## Reference

- Backing primitive (LangGraph): https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/
- AG2 `human_input_mode`: https://docs.ag2.ai/docs/api-reference/autogen/ConversableAgent
- CopilotKit HITL docs: https://docs.copilotkit.ai/human-in-the-loop
