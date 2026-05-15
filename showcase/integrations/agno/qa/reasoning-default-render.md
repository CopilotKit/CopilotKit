# QA: Reasoning (Default Render) — Agno

## Prerequisites

- Demo deployed at `/demos/reasoning-default-render`
- Agno reasoning agent served at `/reasoning/agui`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/reasoning-default-render`
- [ ] Send "Why is the sky blue? Think step by step."
- [ ] Verify the built-in `CopilotChatReasoningMessage` renders a collapsible
      "Thought for X seconds" card
- [ ] Verify the final assistant answer appears after the reasoning card

### 2. Feature-Specific Checks

- [ ] Expand the reasoning card; verify step-by-step content is visible
- [ ] No custom slot override was required — this is zero-config reasoning
      rendering

### 3. Error Handling

- [ ] No uncaught console errors
