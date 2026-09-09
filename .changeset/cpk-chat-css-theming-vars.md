---
"@copilotkit/react-core": minor
---

feat(react-core): theme chat elements via --cpk-\* CSS variables

Add CSS custom properties that expose the chat elements which previously
hardcoded literal colors — the input pill background, the send button
(including its disabled state), the input/message toolbar buttons, and the
slash menu. Recoloring these to match a host design system no longer requires
slot-level `!important` overrides; a single scoped `[data-copilotkit]` block of
`--cpk-*` variables is enough.

Each variable defaults to the exact original literal, so the default appearance
is unchanged in both light and dark themes.
