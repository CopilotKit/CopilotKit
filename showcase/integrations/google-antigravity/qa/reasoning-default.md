# QA: Reasoning (Default) — Google Antigravity

> **Not supported on this integration — nothing to QA.**
>
> `reasoning-default` is declared in `manifest.yaml` under
> `not_supported_features`. The Antigravity Go harness drops the model's
> `reasoning_content` deltas instead of forwarding them as a thinking step, so
> no AG-UI `THINKING_*` event ever reaches the frontend and CopilotKit's
> reasoning surfaces (`CopilotChatReasoningMessage`,
> `[data-testid="reasoning-block"]`, the built-in `Thinking… / Thought for…`
> label) never mount. The page still loads and answers — it renders what would
> have been the reasoning as ordinary assistant text.
>
> Measured and root-caused in [`../PARITY_NOTES.md`](../PARITY_NOTES.md#reasoning);
> nothing in a fixture or a thin agent can change it. Revisit when the harness
> forwards `reasoning_content` as a thinking step, at which point restore the
> checklist from the reference package
> (`showcase/integrations/langgraph-python/qa/reasoning-default.md`).
