# Reasoning (Custom Render)

Visible reasoning / thinking chain rendered via a custom `reasoningMessage` slot.

The Python agent emits AG-UI `REASONING_MESSAGE_*` events primarily by
forwarding Claude's native extended-thinking (`thinking_delta`) channel —
extended thinking is enabled on the stream, so Claude's step-by-step plan
arrives on the native `thinking` content blocks, which the agent maps
directly onto `REASONING_MESSAGE_*`. Parsing `<reasoning>...</reasoning>`
blocks out of the text stream remains only as a fallback for a
no-native-thinking deployment. The `ReasoningBlock` component re-skins the
reasoning as an amber-tagged, italic "Agent reasoning" card.
