# QA: Observational Memory — Mastra

Observational Memory (OM) is a Mastra `Memory` feature. As the conversation
grows past a token threshold, Mastra runs an Observer OUT OF BAND that compresses
unobserved messages into structured observations and activates them into the
working context. Mastra streams that background work on the run's `fullStream` as
`data-om-*` chunks; the AG-UI Mastra adapter maps them to
`mastra-observational-memory` activity events, and the demo's custom activity
renderer paints them inline in the chat.

## Prerequisites

- Demo is deployed and accessible with a REAL LLM key (OM's Observer makes its
  own out-of-band LLM call — see the determinism note below).
- `observationalMemoryAgent` has OM enabled on its Memory
  (`options.observationalMemory`, scope `thread`, floor `600/300`).
- The route surfaces it: `getLocalAgents({ observationalMemory: true })`.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/observational-memory`
- [ ] Verify the chat interface loads in a centered full-height layout
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Verify both suggestion pills are visible:
  - "Brief my analytics project"
  - "Plan a two-week trip"

### 2. Observational Memory activity (REAL LLM only)

- [ ] Click "Brief my analytics project" (sends a large multi-paragraph message
      sized to cross the OM token threshold)
- [ ] Verify the agent replies with a concise product-risk summary
- [ ] Verify an OM activity card (`data-testid="om-activity-card"`) appears
      inline in the transcript. Expected phases (one card per OM cycle,
      advancing in place):
  - "Compressing memory · Working" (buffering start)
  - then "Compressing memory · Compressed" and/or
        "Activating observations · Activated" as the cycle completes
- [ ] Note: the card frequently reads "Working" within the turn — OM completion
      and activation are timing-adjacent and can trail the streamed response.
      Send a second sizable message (or click the other pill) to see the card
      settle to completed/activated.
- [ ] Click "Plan a two-week trip" and verify the same OM activity behavior on a
      fresh cycle.

### 3. Error Handling

- [ ] Verify no console errors during normal usage
- [ ] Verify the chat still streams a clean assistant response even if the OM
      card does not paint (OM is additive — the run must never break)

## Expected Results

- Chat loads within 3 seconds; agent responds within ~10 seconds.
- With a real LLM, sizable messages trip OM and render at least one
  `mastra-observational-memory` activity card.
- The response text is never blocked by OM work (OM is out of band).

## Determinism note (why the e2e is scoped)

The OM activity card is NOT deterministically reproducible under aimock. The
`data-om-*` chunks come from `@mastra/memory`'s OM processor on the run's
`fullStream` (driven by runtime token accounting plus an out-of-band Observer
LLM call), NOT from the mocked chat-completion response — aimock has no lever to
force them, and completion/activation is timing-adjacent. The Playwright spec
(`tests/e2e/observational-memory.spec.ts`) therefore asserts only the
deterministic subset (page loads, both pills present, a pill click produces a
completing assistant turn) and probes the OM card best-effort without failing on
it. Full OM-card verification is this manual real-LLM pass plus the adapter's own
upstream unit tests.
