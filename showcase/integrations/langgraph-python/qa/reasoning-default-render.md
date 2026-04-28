# QA: Reasoning (Default Render) — LangGraph (Python)

> Stub — authored for column completeness. This is a testing-kind demo
> (see `kind: "testing"` in feature-registry.json) and does not warrant a
> full manual checklist.

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to /demos/reasoning-default-render
- [ ] Send any prompt that elicits a reasoning response and verify the built-in `CopilotChatReasoningMessage` collapsible card renders the reasoning tokens
- [ ] Verify no custom reasoning slot is wired (default styling only — no `ReasoningBlock` or bespoke container)

## Expected Results

- Page loads without errors
- Reasoning renders via CopilotKit's default `CopilotChatReasoningMessage` component with zero frontend configuration
