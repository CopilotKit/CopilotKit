# QA: reasoning-custom

## Scope

Manual QA checklist for the `reasoning-custom` demo. Same backend as
`reasoning-default`; the difference is the frontend `messageView.reasoningMessage`
slot override that paints the custom amber ReasoningBlock.

## Happy path

- [ ] Navigate to `/demos/reasoning-custom`.
- [ ] Send one of the suggestion pills.
- [ ] Verify the custom reasoning block renders (not the built-in header).
- [ ] Verify the final answer renders below it.

## Regression

- [ ] No hydration warnings in the browser console.
- [ ] The built-in reasoning renderer does NOT also appear.

## Known gaps

- Reasoning summaries only appear on reasoning-capable models. Override the
  model with `OPENAI_REASONING_MODEL`.
