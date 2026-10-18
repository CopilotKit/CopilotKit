---
"@copilotkit/react-core": patch
---

fix(react-core): wrap CopilotChatInput disclaimer slot in pointer-events-auto so interactive content (links, buttons, agent selectors) inside a custom disclaimer stays clickable. The outer container's pointer-events:none is preserved.
