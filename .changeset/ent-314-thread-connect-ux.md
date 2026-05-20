---
"@copilotkit/react-core": minor
"@copilotkit/core": patch
---

fix(threads): stabilize thread-switch UX, skip /connect for absent threads

- Skip `connectAgent` when `CopilotChat` is rendered without a caller-supplied `threadId`. A locally-minted UUID has no backend record, so `/connect` would always 404 on the intelligence platform.
- Expose `lastRunAt` on `Thread` and use it (with fallback to `updatedAt`, then `createdAt`) as the `useThreads` sort key so metadata-only actions like archive/rename no longer reshuffle the list.
- `useThreads` waits for `runtimeConnectionStatus === Connected` before dispatching the store context, eliminating a speculative `/threads` fetch that fired before `/info` returned `wsUrl`.
- Reserve room for the fixed "Powered by CopilotKit" license badge via a new `--copilotkit-license-banner-offset` CSS var published by the banner; chat input consumes it when bottom-anchored so the two no longer overlap.
- Add a new `bottomAnchored` prop on `CopilotChatInput` for callers rendering it as a flex-last-child.

**Behavior change (chat suggestions):** `CopilotChatView` no longer renders suggestions while `isRunning` is true. Previously, suggestions could appear against a streaming-in message tree and visibly reflow as text chunks landed. If you relied on suggestions staying visible during a run, you'll now see them only once the run finalizes (or the thread's initial connect completes).
