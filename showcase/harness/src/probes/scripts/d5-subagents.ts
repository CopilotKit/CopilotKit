/**
 * D5 — `subagents` script.
 *
 * Phase-2A split (see `.claude/specs/lgp-test-genuine-pass.md`): the old
 * `d5-mcp-subagents.ts` probe claimed both `mcp-apps` and `subagents`
 * with a shared text-fragment assertion. This probe is now scoped to
 * `subagents` only and asserts the 3 subagent-card testids that
 * Phase-1D introduces in production code:
 *
 *   - `[data-testid="subagent-card-researcher"]`
 *   - `[data-testid="subagent-card-writer"]`
 *   - `[data-testid="subagent-card-critic"]`
 *
 * The chain unfolds as research → writing → critique. We still rely on
 * the existing `mcp-subagents.json` fixture (recorded against this same
 * supervisor flow) so the conversation drives all three sub-agents in
 * one turn.
 *
 * Assertions:
 *   1. All three subagent cards present at terminal state.
 *   2. The critic appears EXACTLY ONCE (no looping / re-entry — Phase-1D
 *      backend bug fix). Drift here would indicate the supervisor
 *      regressed into re-invoking the critic agent.
 *   3. The rendered transcript contains non-boilerplate content — proxy
 *      for "the chain produced a coherent reply rather than canned
 *      placeholder text".
 *
 * Side effect: importing this module triggers `registerD5Script`. The
 * default loader in `e2e-deep.ts` discovers it via the `d5-*` filename
 * convention.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/**
 * Subagent-card testids introduced by Phase-1D production code on
 * `/demos/subagents`. The probe asserts each is present in the DOM at
 * terminal state.
 */
export const SUBAGENT_CARD_TESTIDS = [
  "subagent-card-researcher",
  "subagent-card-writer",
  "subagent-card-critic",
] as const;

/**
 * The single user prompt that triggers the supervisor → research →
 * writing → critique chain. Verbatim match against the fixture's
 * `userMessage` matcher in `mcp-subagents.json` — drift would route the
 * request to the live model rather than the recorded chain.
 */
export const USER_PROMPT =
  "Research the benefits of remote work and draft a one-paragraph summary";

/**
 * Boilerplate phrases that, if found in the rendered transcript, suggest
 * the chain DIDN'T actually run and the page is showing canned/empty
 * state instead. Lowercased — the assertion lowercases the page text
 * before comparing.
 *
 * The list is intentionally short — over-specifying boilerplate creates
 * false negatives when integrations word their placeholder text
 * differently. The two phrases below are common no-op markers.
 */
const BOILERPLATE_MARKERS = [
  "no messages yet",
  "start a conversation",
  // Sentinel emitted by `_invoke_sub_agent` in
  // `showcase/integrations/langgraph-python/src/agents/subagents.py`
  // when a sub-agent produces no usable text. Lower-cased to match the
  // probe's `text.toLowerCase()` snapshot.
  "<sub-agent produced no output>",
] as const;

/** Total time we'll poll for the chain to complete, in ms. The chain
 *  involves 3 sequential LLM round-trips, so even with aimock the
 *  React render of all three cards takes a non-trivial moment. */
const CHAIN_POLL_TIMEOUT_MS = 30_000;
const CHAIN_POLL_INTERVAL_MS = 500;

/** After all three cards are present and the validator passes, we hold
 *  for this dwell window and re-snapshot. This catches a regression
 *  where the supervisor briefly shows a single critic card before a
 *  loop fires — without the dwell, the probe would return at the first
 *  passing snapshot and miss the second critic appearing. */
export const CHAIN_SETTLE_DWELL_MS = 3_000;

/** Snapshot read off the page in a single `page.evaluate` round-trip.
 *  Carries everything the assertion needs so we don't make N
 *  round-trips on each poll iteration. */
export interface SubagentsProbeSnapshot {
  /** Per-testid presence count (researcher / writer / critic). */
  counts: Record<(typeof SUBAGENT_CARD_TESTIDS)[number], number>;
  /** Lowercased page text — for non-boilerplate-content assertion. */
  text: string;
}

/**
 * Snapshot the page in one round-trip. The selector list and the
 * boilerplate markers are hard-coded inside the evaluated function
 * because Playwright's `evaluate(() => R)` shape doesn't carry closure
 * captures across the serialisation boundary.
 *
 * The function returns testid counts (so a critic-loop regression that
 * stacks duplicates surfaces as count > 1) plus the lowercased
 * `document.body.textContent`.
 */
export async function probeSubagents(
  page: Page,
): Promise<SubagentsProbeSnapshot> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): { length: number };
        body: { textContent: string | null };
      };
    };
    const researcher = win.document.querySelectorAll(
      '[data-testid="subagent-card-researcher"]',
    ).length;
    const writer = win.document.querySelectorAll(
      '[data-testid="subagent-card-writer"]',
    ).length;
    const critic = win.document.querySelectorAll(
      '[data-testid="subagent-card-critic"]',
    ).length;
    const text = (win.document.body.textContent ?? "").toLowerCase();
    return {
      counts: {
        "subagent-card-researcher": researcher,
        "subagent-card-writer": writer,
        "subagent-card-critic": critic,
      },
      text,
    };
  });
}

/**
 * Validate a snapshot against the three D5 sub-assertions. Returns
 * `null` when all checks pass, or a human-readable error string on
 * the FIRST failing check.
 *
 * Order matters: card presence is checked before non-boilerplate so an
 * early-render snapshot fails on "missing cards" rather than the more
 * confusing "page contains 'no messages yet'" — operators see the
 * card-render regression as the proximate cause.
 */
export function validateSubagentsSnapshot(
  snap: SubagentsProbeSnapshot,
): string | null {
  for (const testid of SUBAGENT_CARD_TESTIDS) {
    if ((snap.counts[testid] ?? 0) < 1) {
      return `subagents: expected [data-testid="${testid}"] at terminal state but found 0 elements`;
    }
  }
  if ((snap.counts["subagent-card-critic"] ?? 0) > 1) {
    return (
      `subagents: critic ran more than once (count=${snap.counts["subagent-card-critic"]}) — ` +
      "Phase-1D contract is exactly one critic invocation per chain"
    );
  }
  for (const marker of BOILERPLATE_MARKERS) {
    if (snap.text.includes(marker)) {
      return (
        `subagents: page text still contains boilerplate marker "${marker}" — ` +
        "the chain may not have produced a real reply"
      );
    }
  }
  return null;
}

/**
 * Per-turn assertion. Polls until the snapshot passes all checks, or
 * the deadline elapses. The first poll runs immediately so a fast
 * (aimock) chain doesn't pay an unconditional 500ms wait.
 */
export async function assertSubagentsChain(
  page: Page,
  timeoutMs: number = CHAIN_POLL_TIMEOUT_MS,
  dwellMs: number = CHAIN_SETTLE_DWELL_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const snap = await probeSubagents(page);
    pollCount++;
    lastError = validateSubagentsSnapshot(snap);
    if (lastError === null) {
      // First passing snapshot — hold for `dwellMs` and re-snapshot
      // before declaring victory. This catches a regression where the
      // critic renders briefly with count=1 and then the supervisor
      // re-invokes it (count grows to 2). Without the dwell, the
      // probe would return at the first passing snapshot and miss the
      // second critic appearing.
      const initialCounts = { ...snap.counts };
      await new Promise<void>((r) => setTimeout(r, dwellMs));
      const recheck = await probeSubagents(page);
      const recheckError = validateSubagentsSnapshot(recheck);
      if (recheckError !== null) {
        throw new Error(
          `subagents: chain destabilised during ${dwellMs}ms dwell after passing — ${recheckError} ` +
            `(initial counts=${JSON.stringify(initialCounts)}, ` +
            `recheck counts=${JSON.stringify(recheck.counts)})`,
        );
      }
      console.debug("[d5-subagents] all sub-assertions passed (post-dwell)", {
        counts: recheck.counts,
        pollCount,
        dwellMs,
      });
      return;
    }
    if (pollCount === 1 || pollCount % 10 === 0) {
      console.debug("[d5-subagents] poll — not ready yet", {
        pollCount,
        validationError: lastError,
        counts: snap.counts,
      });
    }
    await new Promise<void>((r) => setTimeout(r, CHAIN_POLL_INTERVAL_MS));
  }
  throw new Error(lastError ?? "subagents: poll deadline exceeded");
}

/**
 * Build the per-(integration, featureType) conversation. One user turn
 * triggers the entire supervisor chain. The runner waits for the
 * settle window, then `assertSubagentsChain` polls until the cards
 * land and the critic has run exactly once.
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: USER_PROMPT,
      assertions: assertSubagentsChain,
      // The chain involves 3 LLM round-trips; bump the per-turn
      // response timeout to match the polling budget so the runner
      // doesn't declare timeout BEFORE the assertion has a chance to
      // poll on a settled DOM.
      responseTimeoutMs: 60_000,
    },
  ];
}

registerD5Script({
  featureTypes: ["subagents"],
  fixtureFile: "mcp-subagents.json",
  buildTurns,
});
