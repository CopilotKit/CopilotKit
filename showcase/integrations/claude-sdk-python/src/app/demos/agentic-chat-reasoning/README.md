# Agentic Chat (Reasoning)

Visible reasoning / thinking chain rendered via a custom `reasoningMessage` slot.

The Python agent emits AG-UI `REASONING_MESSAGE_*` events by parsing
`<reasoning>...</reasoning>` blocks out of Claude's text stream. The
`ReasoningBlock` component re-skins them as an amber-tagged, italic
"Agent reasoning" card.
