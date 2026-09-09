---
"@copilotkit/react-core": patch
---

fix(react-core): scope [data-copilotkit] background-color to chat root only

The `data-copilotkit` attribute is applied to dozens of chat-internal nodes (assistant messages, suggestion containers, input wrappers, attachment chips) for CSS-variable scoping. The base rule painted `background-color` on all of them, which defeated any consumer wrapping the chat in a translucent surface — every internal element painted opaque `--background` over their backdrop.

Split the rule: `color` stays on `[data-copilotkit]` for descendant inheritance; `background-color` moves to a new `[data-copilotkit-root]` selector that only chat root containers carry. `CopilotChatView`, `CopilotSidebarView`, and `CopilotPopupView` are tagged with the new attribute, so default-theme appearance is unchanged. Custom translucent themes no longer need per-element overrides.
