import { describe, it, expect } from "vitest";
import { runBubbleRaceRepro } from "./bubble-race-repro.js";

/**
 * Defect 3 — diagnostic selector blindness under cascade fallback (closed).
 *
 * Historical context: `captureDiagnostics` in `d6-all-pills.ts` originally
 * queried ONLY the canonical `[data-testid="copilot-assistant-message"]`
 * selector to compute `assistantMsgCount`, while the conversation runner
 * cascaded through four tiers (canonical → tagged article → non-user
 * article → headless `[data-message-role="assistant"]`). Demos whose
 * bubbles only satisfied a non-canonical tier produced "RED with no
 * errors" diagnostics — the runner settled correctly via the fallback
 * tier, but the diagnostic read was blind to the bubble. The runner's
 * own `[conversation-runner] turn N/total — settled text { turnNum, text }`
 * log line previously read via the same canonical-only selector, so a
 * settled-via-fallback turn would log empty text.
 *
 * Phase 2 (s6) consolidated the cascade behind `countAssistantMessages` /
 * `findAssistantBubbleAt` and routed both `captureDiagnostics` and the
 * conversation runner's settled-text read through it. The runner now
 * sources `settled text` from `waitForTurnComplete`'s
 * `findAssistantBubbleAt(pwPage, bubbleIndex)` return value — the same
 * cascade the count uses — so a tier-4-only demo like
 * `langgraph-python:headless-simple` settles AND surfaces non-empty
 * assistant text in the diagnostic log.
 *
 * Natural fallback target: `langgraph-python:headless-simple`. Its
 * `AssistantBubble` component (showcase/integrations/langgraph-python
 * /src/app/demos/headless-simple/message-bubble.tsx) emits
 *   <div data-testid="headless-message-assistant"
 *        data-message-role="assistant" …>
 *     <p>…</p>
 *   </div>
 * — NO `data-testid="copilot-assistant-message"`, NO `role="article"`.
 * Cascade tiers 1, 2, 3 all yield 0; tier 4 (`[data-message-role=
 * "assistant"]` → `<p>` child read) matches. This test pins the
 * post-cascade GREEN state: the runner finds the bubble AND the
 * settled-text log is non-empty.
 */
describe("bubble-race repro (defect 3: diagnostic selector blindness — closed by shared cascade)", () => {
  it("headless-simple settles a turn AND the runner's settled-text diagnostic reads via the cascade (non-empty)", async () => {
    const result = await runBubbleRaceRepro({
      slug: "langgraph-python:headless-simple",
      level: "d5",
      messages: ["Say hello in one short sentence"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.turns).toHaveLength(1);
    // With the shared cascade in place, the settled-text diagnostic
    // surfaces the tier-4 bubble's text. If this ever flips back to
    // empty, defect-3 has regressed — the runner's `settled text` log
    // is reading via a canonical-only selector again instead of the
    // shared `findAssistantBubbleAt` cascade.
    expect(result.turns[0].assistantText.trim().length).toBeGreaterThan(0);
  }, 180_000);
});
