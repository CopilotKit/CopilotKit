# QA: Observational Memory — Mastra

Observational Memory (OM) is a Mastra `Memory` feature. As the conversation
grows past a token threshold, Mastra runs an Observer OUT OF BAND that compresses
unobserved messages into structured observations and activates them into the
working context. Mastra streams that background work on the run's `fullStream` as
`data-om-*` chunks; the AG-UI Mastra adapter maps them to
`mastra-observational-memory` activity events, and the demo's custom activity
renderer paints them inline in the chat.

This QA pass covers the OBSERVATION CONTENT quality with a real LLM. The
activity-card LIFECYCLE STRUCTURE (a `buffering / running` card in-turn, settling
to `activation / activated`) is already asserted deterministically under aimock by
`tests/e2e/observational-memory.spec.ts` — see the determinism note at the bottom.

## Prerequisites

- Demo is deployed and accessible with a REAL LLM key (OM's Observer makes its
  own out-of-band LLM call; a real key is what produces meaningful observation
  text — see the determinism note below).
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

### 2. Observational Memory activity + observation content (REAL LLM)

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
- [ ] REAL-LLM-ONLY check: expand the card and verify the observation text
      (`data-testid="om-observations"`) is a MEANINGFUL compression of the
      conversation (e.g. names the project / trip specifics). Under aimock this
      text is a stand-in, so this semantic check is the reason a real key is
      required here.
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

## Determinism note (what the e2e asserts vs. what needs a real LLM)

Corrected 2026-07-02 after direct measurement against the sanctioned aimock rig
(`showcase up mastra --dev`, per-integration Playwright against :3104).

The OM activity-card LIFECYCLE STRUCTURE **is** deterministic under aimock, so the
Playwright spec (`tests/e2e/observational-memory.spec.ts`) asserts it:

- A single sizable pill click always trips OM's token threshold and paints
  exactly one card in `buffering / running` in-turn. This is driven by runtime
  token accounting over the fixed-size pill message and does NOT depend on the
  Observer LLM response, so it is stable (measured 11/11).
- The Observer's out-of-band LLM call goes through aimock too, so the cycle DOES
  complete and activate — that delta lands just after the turn, surfacing on the
  NEXT run. After a second sizable turn the first cycle's card reads
  `activation / activated` and the new turn opens a fresh `buffering / running`
  card (measured 5/5). The spec's fourth test asserts this.

What aimock does NOT reproduce is the observation SEMANTIC CONTENT: aimock returns
a stand-in for the Observer call rather than a genuine compression of the
conversation, so the `om-observations` text is not meaningful under replay. That
content quality is what THIS real-LLM QA pass (§2) plus the adapter's own upstream
unit tests cover. In short: structure → e2e (aimock, deterministic); content →
real-LLM QA.
