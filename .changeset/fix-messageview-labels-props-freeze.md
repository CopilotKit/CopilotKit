---
"@copilotkit/react-core": patch
---

fix: stabilize messageView and labels props to prevent message list re-renders on every keystroke

Passing `messageView` or `labels` as inline object props to `<CopilotChat />` previously caused all completed assistant messages to re-render on every keystroke due to reference instability. This was especially severe with large message histories (DocuSign: 100+ messages reported 2s→16s send time degradation).

Root causes fixed:

- `ts-deepmerge.merge()` deep-cloned plain objects even from a single source, creating a new reference every render that defeated `MemoizedSlotWrapper`'s shallow equality check. Replaced with shallow spread + `useShallowStableRef`.
- Inline `labels` objects created a new `mergedLabels` context value every render, causing all `useCopilotChatConfiguration()` consumers across every message to re-render. Fixed by stabilizing with `useShallowStableRef` in `CopilotChatConfigurationProvider`.

The `useShallowStableRef` hook (added to `slots.tsx`) is now the single stabilization primitive: it returns the same reference as long as the value is shallowly equal, with an `isPlainObject` guard to avoid incorrect equality for arrays, Dates, and class instances.
