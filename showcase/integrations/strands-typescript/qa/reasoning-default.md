# QA: reasoning-default

## Scope

Manual QA checklist for the `reasoning-default` demo. The demo runs
against a dedicated reasoning agent on the OpenAI Responses API with reasoning
summaries enabled, and renders them with CopilotKit's built-in
`CopilotChatReasoningMessage` (no slot override).

## Happy path

- [ ] Navigate to `/demos/reasoning-default`.
- [ ] Send one of the suggestion pills.
- [ ] Verify a "Thinking…" / "Thought for …" header appears and expands to show
      the reasoning summary.
- [ ] Verify the final answer renders below it.

## Regression

- [ ] No hydration warnings in the browser console.
- [ ] A second turn in the same thread still streams reasoning (a reasoning-role
      message replayed from turn 1 must not break the next request).

## Known gaps

- Reasoning summaries only appear on reasoning-capable models. Override the
  model with `OPENAI_REASONING_MODEL`.
