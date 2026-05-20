# HITL (built-in-agent)

This route hosts the working **`hitl-in-chat`** demo (per the manifest:
`hitl-in-chat` → `/demos/hitl`). It uses `useHumanInTheLoop` to ask the
user to approve a sensitive action before the agent runs it — fully
supported by built-in-agent because it's driven by frontend tool
interception, not a graph-level interrupt.

## Note on the unsupported `hitl` feature

The showcase feature column also has a separate `hitl` feature ID
(distinct from `hitl-in-chat`) that maps to LangGraph's graph-interrupt
flow. That variant is **not supported** by built-in-agent — see
`manifest.yaml` `not_supported_features` and the
`gen-ui-interrupt` / `interrupt-headless` placeholder demos for the
same root cause: TanStack AI's chat-completions factory has no
graph-interrupt primitive. Use the `langgraph-python` integration for
that flow.
