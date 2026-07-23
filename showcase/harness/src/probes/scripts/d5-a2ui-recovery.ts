/**
 * D5 — a2ui-recovery script.
 *
 * Drives `/demos/a2ui-recovery`, the A2UI error-recovery demo
 * (OSS-158 / OSS-375). Two suggestion pills exercise the
 * validate->retry recovery loop deterministically via aimock fixtures
 * (`showcase/aimock/d6/<slug>/a2ui-recovery.json`):
 *
 *   - HEAL ("Recover a bad render"): the inner `render_a2ui` sub-agent
 *     emits free-form/sloppy args on the first attempt; the recovery
 *     middleware heals them (parse_and_fix) into a valid surface that
 *     paints. End-state: the declarative catalog surface mounts
 *     (>= 2 `declarative-metric` tiles) and NO hard-failure card.
 *   - EXHAUST ("Show an unrecoverable failure"): every render attempt
 *     is structurally invalid; the loop hits the attempt cap and
 *     returns the `a2ui_recovery_exhausted` envelope. End-state: the
 *     hard-failure card text "Couldn't generate the UI" appears and NO
 *     surface paints.
 *
 * Per-framework prompt isolation (load-bearing): the recovery PROMPTS
 * are UNIQUE per integration slug. The inner `render_a2ui` calls carry
 * no `x-aimock-context`, so identical prompts across frameworks would
 * collide in the shared aimock matcher. Each pill's `message` string is
 * therefore unique per slug — see each slug's
 * `src/app/demos/a2ui-recovery/suggestions.ts`. This probe SENDS that
 * exact per-slug message as the turn input (typing + Enter), which is
 * byte-identical to what the pill dispatches, so it matches the same
 * fixture the pill would. The prompts below MIRROR those
 * `suggestions.ts` files (same mirror discipline as
 * `d5-gen-ui-declarative.ts` / `d5-gen-ui-interrupt.ts`).
 *
 * Why typed-input and NOT a pill click: clicking the pill from a
 * `preFill` hook (with `skipSend`) starts the agent run BEFORE the
 * conversation runner snapshots its run-lifecycle baseline
 * (`baselineRunStartCount`), so the runner's "a new run started" gate
 * (`runStartCount > baselineRunStartCount`) can never trip and the turn
 * fails `done-signal-missing` even though the surface painted. Sending
 * the message as normal turn input lets the runner capture its baseline
 * first, exactly like the working declarative probe.
 *
 * HEAL is sent EXACTLY ONCE. The heal fixture stages invalid->valid via
 * aimock `sequenceIndex` (0 invalid, 1 valid); a single heal request
 * drives the internal retry (seq0 -> seq1) in one pass. The two-turn
 * shape (one heal, one exhaust) guarantees exactly one heal send — a
 * second would advance past seq1 and fail.
 *
 * Assertion design (mirrors `d5-gen-ui-declarative.ts`): both turns run
 * in ONE browser session, so A2UI render nodes and the failure card
 * accumulate across turns. The two end-states are mutually-exclusive
 * NEGATIVES (heal: no failure; exhaust: no surface), so each turn
 * captures a pre-send baseline in `preFill` and asserts DELTAS — heal
 * requires >= 2 NEW `declarative-metric` tiles and ZERO new failure
 * cards; exhaust requires >= 1 NEW failure card and ZERO new
 * `declarative-metric` tiles.
 *
 * The transient "Retrying generation… (N/M)" label is deliberately NOT
 * asserted — it is threshold-gated + timing dependent (see
 * `@copilotkit/react-core/v2` A2UIRecoveryStates) and would be flaky.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { FIRST_SIGNAL_TIMEOUT_MS } from "./_genuine-shared.js";

/** The healed surface reuses the declarative-gen-ui catalog, so it
 *  carries the `declarative-metric` testid. */
const METRIC_TESTID = "declarative-metric";

/** Hard-failure card copy from `A2UIRecoveryFailure`
 *  (`@copilotkit/react-core/v2` A2UIRecoveryStates). The card has no
 *  testid, so the probe matches this stable literal. */
const FAILURE_TEXT = "Couldn't generate the UI";

/** Minimum healed `declarative-metric` tiles the heal pill must newly
 *  mount. Mirrors the e2e spec's `>= 2` threshold — a lone widget is
 *  not a healed dashboard. */
const HEAL_MIN_METRICS = 2;

/** Per-turn response budget. The heal request drives a sub-agent
 *  round-trip + the validate->retry loop, so allow the same headroom as
 *  the declarative probe (settle window + cold-start tax). */
const RECOVERY_RESPONSE_TIMEOUT_MS = FIRST_SIGNAL_TIMEOUT_MS + 30_000;

/**
 * Per-slug heal/exhaust prompts. MIRRORS each slug's
 * `src/app/demos/a2ui-recovery/suggestions.ts` `message` strings
 * verbatim — they are the aimock fixture keys, so they must match
 * byte-for-byte. Unique per slug on purpose (see the module docstring).
 */
const PROMPTS: Readonly<Record<string, { heal: string; exhaust: string }>> = {
  "google-adk": {
    heal: "Render my Q2 sales dashboard, recovering if the first attempt is malformed.",
    exhaust:
      "Render a dashboard that keeps failing validation so I can see the fallback.",
  },
  "langgraph-python": {
    heal: "Build my Q2 revenue summary and self-correct a malformed first attempt.",
    exhaust:
      "Build a report that fails every validation pass so I can preview the fallback.",
  },
  "langgraph-fastapi": {
    heal: "Put together a quarterly metrics overview and repair a malformed first attempt.",
    exhaust:
      "Put together an overview whose every render is invalid so I can see the fallback.",
  },
  "langgraph-typescript": {
    heal: "Lay out a sales KPI panel and heal a broken first attempt.",
    exhaust:
      "Lay out a KPI panel that never passes validation so I can reveal the fallback.",
  },
  mastra: {
    heal: "Draft the Vantage quarterly revenue tile and mend a botched opening attempt.",
    exhaust:
      "Draft a Vantage board that flunks every validation sweep so I can preview the fallback.",
  },
  "ms-agent-dotnet": {
    heal: "Generate the Vantage .NET quarterly revenue board and self-heal a malformed first render.",
    exhaust:
      "Generate a .NET board that fails every validation pass so I can preview the recovery fallback.",
  },
  strands: {
    heal: "Assemble a quarterly performance board and recover from a malformed first draft.",
    exhaust:
      "Assemble a board that always fails validation so I can see the fallback.",
  },
  "strands-typescript": {
    heal: "Compose a revenue snapshot and recover if the first attempt is malformed.",
    exhaust:
      "Compose a snapshot that keeps failing validation so I can show the fallback.",
  },
};

interface RecoveryCounts {
  /** Count of `[data-testid="declarative-metric"]` elements. */
  metric: number;
  /** Number of hard-failure cards (occurrences of `FAILURE_TEXT`). */
  failure: number;
}

/** Read the current `declarative-metric` element count and the number
 *  of hard-failure cards in ONE browser round-trip. The selector and
 *  failure literal are written DIRECTLY into the zero-arg closure source
 *  (not captured from the outer scope and not passed as a `page.evaluate`
 *  arg) — the harness worker does not reliably round-trip closure
 *  captures or the second `evaluate` argument to the browser side. Same
 *  zero-arg-with-inlined-literals convention as `readDeclarativeTestIds`. */
async function readRecoveryCounts(page: Page): Promise<RecoveryCounts> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): { length: number };
        body: { innerText: string } | null;
      };
    };
    const metric = win.document.querySelectorAll(
      '[data-testid="declarative-metric"]',
    ).length;
    const body = win.document.body?.innerText ?? "";
    const needle = "Couldn't generate the UI";
    let failure = 0;
    let from = 0;
    for (;;) {
      const at = body.indexOf(needle, from);
      if (at === -1) break;
      failure++;
      from = at + needle.length;
    }
    return { metric, failure };
  })) as RecoveryCounts;
}

/** Per-pill baseline ref: the recovery-surface counts BEFORE the turn is
 *  sent. Closed over by both `preFill` (writes) and the assertion
 *  (reads). Necessary because both surfaces accumulate across the two
 *  turns, so an absolute check would trivially pass on the other pill's
 *  leftover. */
interface RecoveryBaselineRef {
  counts: RecoveryCounts;
  captured: boolean;
}

/** Build the `preFill` hook: capture the pre-send baseline (read only —
 *  it must NOT start an agent run, or the runner's run-lifecycle gate
 *  would mis-baseline). */
function buildBaselineCapture(
  ref: RecoveryBaselineRef,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    ref.counts = await readRecoveryCounts(page);
    ref.captured = true;
  };
}

/** Build the HEAL assertion: at settle, the turn must have newly mounted
 *  at least `HEAL_MIN_METRICS` `declarative-metric` tiles (current -
 *  baseline) and must NOT have produced a new hard-failure card. */
function buildHealAssertion(
  ref: RecoveryBaselineRef,
): (page: Page) => Promise<void> {
  const tag = "a2ui-recovery-heal";
  return async (page: Page): Promise<void> => {
    if (!ref.captured) {
      throw new Error(`${tag}: baseline was not captured by preFill`);
    }
    const deadline = Date.now() + FIRST_SIGNAL_TIMEOUT_MS;
    let last: RecoveryCounts = { metric: 0, failure: 0 };
    while (Date.now() < deadline) {
      last = await readRecoveryCounts(page);
      const newMetrics = last.metric - ref.counts.metric;
      const newFailures = last.failure - ref.counts.failure;
      if (newMetrics >= HEAL_MIN_METRICS && newFailures <= 0) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    const newMetrics = last.metric - ref.counts.metric;
    const newFailures = last.failure - ref.counts.failure;
    throw new Error(
      `${tag}: heal turn did not paint a healed surface within ${FIRST_SIGNAL_TIMEOUT_MS}ms ` +
        `(new ${METRIC_TESTID}=${newMetrics} need >= ${HEAL_MIN_METRICS}; ` +
        `new "${FAILURE_TEXT}" cards=${newFailures} need <= 0)`,
    );
  };
}

/** Build the EXHAUST assertion: at settle, the turn must have newly
 *  shown at least one hard-failure card and must NOT have newly mounted
 *  any `declarative-metric` tile (the server-side no-wipe guarantee:
 *  an exhausted recovery never paints a faulty surface). */
function buildExhaustAssertion(
  ref: RecoveryBaselineRef,
): (page: Page) => Promise<void> {
  const tag = "a2ui-recovery-exhaust";
  return async (page: Page): Promise<void> => {
    if (!ref.captured) {
      throw new Error(`${tag}: baseline was not captured by preFill`);
    }
    const deadline = Date.now() + FIRST_SIGNAL_TIMEOUT_MS;
    let last: RecoveryCounts = { metric: 0, failure: 0 };
    while (Date.now() < deadline) {
      last = await readRecoveryCounts(page);
      const newMetrics = last.metric - ref.counts.metric;
      const newFailures = last.failure - ref.counts.failure;
      if (newFailures >= 1 && newMetrics <= 0) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    const newMetrics = last.metric - ref.counts.metric;
    const newFailures = last.failure - ref.counts.failure;
    throw new Error(
      `${tag}: exhaust turn did not show the hard-failure card within ${FIRST_SIGNAL_TIMEOUT_MS}ms ` +
        `(new "${FAILURE_TEXT}" cards=${newFailures} need >= 1; ` +
        `new ${METRIC_TESTID}=${newMetrics} need <= 0)`,
    );
  };
}

export function buildTurns(ctx: D5BuildContext): ConversationTurn[] {
  const prompts = PROMPTS[ctx.integrationSlug];
  if (!prompts) {
    // Fail loud: a slug with the a2ui-recovery demo but no prompt entry
    // here would otherwise send the wrong text and silently miss the
    // per-slug fixture. Add the slug's suggestions.ts messages above.
    throw new Error(
      `a2ui-recovery: no per-slug prompts registered for "${ctx.integrationSlug}" ` +
        `— add its heal/exhaust messages (from its suggestions.ts) to PROMPTS`,
    );
  }

  // HEAL first, EXHAUST second. Order does not affect correctness (the
  // delta-baseline gate attributes each surface to the turn that
  // produced it), but it keeps the natural demo narrative and sends
  // heal exactly once.
  const healRef: RecoveryBaselineRef = {
    counts: { metric: 0, failure: 0 },
    captured: false,
  };
  const exhaustRef: RecoveryBaselineRef = {
    counts: { metric: 0, failure: 0 },
    captured: false,
  };

  return [
    {
      input: prompts.heal,
      preFill: buildBaselineCapture(healRef),
      assertions: buildHealAssertion(healRef),
      responseTimeoutMs: RECOVERY_RESPONSE_TIMEOUT_MS,
      // The healed surface paints `render_a2ui` output; treat the turn as
      // complete when the metric surface mounts (same swap the declarative
      // probe uses). The strict per-pill delta gate still lives in the
      // assertion above; this only governs WHEN the assertion runs.
      completeOnMount: {
        testIds: [METRIC_TESTID],
        minNewMounts: 1,
      },
    },
    {
      input: prompts.exhaust,
      preFill: buildBaselineCapture(exhaustRef),
      assertions: buildExhaustAssertion(exhaustRef),
      responseTimeoutMs: RECOVERY_RESPONSE_TIMEOUT_MS,
      // The hard-failure card renders REAL text ("Couldn't generate the
      // UI") inside the assistant bubble, so the runner's default
      // text-stability settle converges here — no completeOnMount needed.
    },
  ];
}

registerD5Script({
  featureTypes: ["a2ui-recovery"],
  fixtureFile: "a2ui-recovery.json",
  buildTurns,
});
