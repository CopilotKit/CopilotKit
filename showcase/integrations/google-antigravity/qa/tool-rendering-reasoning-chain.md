# QA: Tool Rendering (Reasoning Chain) — Google Antigravity

> **Not supported on this integration — nothing to QA.**
>
> `tool-rendering-reasoning-chain` is declared in `manifest.yaml` under
> `not_supported_features`, for the same root cause as `reasoning-default` and
> `reasoning-custom`: the Antigravity Go harness drops the model's
> `reasoning_content` deltas, so no thinking step and no reasoning surface ever
> reaches the chat. This demo's whole signal is one additional
> `reasoning-block` mount per tool turn, so it cannot be exercised here — the
> tool cards render, the reasoning between them does not.
>
> Measured and root-caused in [`../PARITY_NOTES.md`](../PARITY_NOTES.md#reasoning).
> Revisit when the harness forwards `reasoning_content` as a thinking step, at
> which point restore the checklist from the reference package
> (`showcase/integrations/langgraph-python/qa/tool-rendering-reasoning-chain.md`).
