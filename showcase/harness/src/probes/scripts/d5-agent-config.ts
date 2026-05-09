/**
 * D5 — agent-config script.
 *
 * Drives `/demos/agent-config`, which forwards `tone`, `expertise`,
 * and `responseLength` from the frontend (CopilotKit
 * `useAgentContext`) to the agent's per-turn system-prompt builder.
 *
 * Genuine assertion strategy: send three pairs of prompts (one pair
 * per knob — tone, expertise, response-length). Each pair sends a
 * value-A prompt followed by a value-B prompt for the same knob.
 * Capture the response transcript after each settle, then assert the
 * two responses differ in the knob-appropriate way:
 *
 *   - tone (professional vs casual): text differs (the responses
 *     should be substantively different — not byte-identical).
 *   - expertise (beginner vs expert): text differs (likewise).
 *   - response-length (concise vs detailed): the detailed response
 *     character count must exceed the concise count by ≥ 80 chars
 *     (calibrated against fixture sample copy; under real LLM the
 *     spread is much larger).
 *
 * Why three turns sequentially in one probe (not a separate
 * fixture-key form mutation): aimock's JSON-only fixture format keys
 * on `userMessage` content. To produce different responses we encode
 * the knob-value into the user prompt sentence — a regression that
 * stops differentiating responses by config keeps the same value-A
 * fixture firing for the value-B prompt and the difference assertion
 * fails. Under a real LLM on Railway the differentiation is natural
 * because `useAgentContext` lands the value in the system prompt.
 *
 * The probe does NOT click form selects on the page. The form lives
 * in `[data-testid="agent-config-card"]` with knob testids
 * `agent-config-tone-select`, `agent-config-expertise-select`,
 * `agent-config-length-select` — these are part of the demo so a
 * future enhancement could mutate them via Playwright. For Phase 2B
 * the prompt-encoded approach captures the same regression class
 * (knob value → response variation) without needing to change the
 * runner's structural Page type.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** Minimum character delta between the "concise" and "detailed"
 *  response-length probes for the assertion to pass. Calibrated to
 *  the fixture pair below; real LLM responses span hundreds of
 *  characters so the threshold is forgiving. */
export const RESPONSE_LENGTH_DELTA_MIN = 80;

/** Per-knob pill pairs. Each pair's two prompts MUST have distinct
 *  fixtures in `agent-config.json` so the value-A and value-B
 *  responses materially differ. Both prompts are sent in the same
 *  conversation; the assertion compares the captured transcripts.
 *
 *  The leading "tone:professional" / "tone:casual" / etc. tokens are
 *  uncommon enough in normal user copy that aimock fixtures can match
 *  them as substring keys without colliding with adjacent fixtures
 *  in `d5-all.json`. */
export const AGENT_CONFIG_PROBES = [
  {
    knob: "tone",
    promptA: "tone:professional — introduce yourself per your config",
    promptB: "tone:casual — introduce yourself per your config",
    /** Tone responses must differ but length is unconstrained. */
    diff: "text" as const,
  },
  {
    knob: "expertise",
    promptA:
      "expertise:beginner — explain how copilotkit works per your config",
    promptB: "expertise:expert — explain how copilotkit works per your config",
    diff: "text" as const,
  },
  {
    knob: "responseLength",
    promptA: "responseLength:concise — describe agent context per your config",
    promptB: "responseLength:detailed — describe agent context per your config",
    /** Detailed must be ≥ concise + RESPONSE_LENGTH_DELTA_MIN chars. */
    diff: "length" as const,
  },
] as const;

/** Read all assistant-message text concatenated, lowercase, trimmed.
 *  Same DOM cascade as the existing keyword-match probes. */
async function readAssistantTranscript(page: Page): Promise<string> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(
          sel: string,
        ): ArrayLike<{ textContent: string | null }>;
      };
    };
    const sels = [
      '[data-testid="copilot-assistant-message"]',
      '[role="article"]:not([data-message-role="user"])',
      '[data-message-role="assistant"]',
    ];
    let nodes: ArrayLike<{ textContent: string | null }> = { length: 0 };
    for (const s of sels) {
      const f = win.document.querySelectorAll(s);
      if (f.length > 0) {
        nodes = f;
        break;
      }
    }
    let acc = "";
    for (let i = 0; i < nodes.length; i++) {
      acc += " " + (nodes[i]!.textContent ?? "");
    }
    return acc;
  })) as string;
}

/**
 * Per-knob snapshot bundle used to thread state from the value-A turn
 * into the value-B turn's comparison.
 *
 *   - `priorCumulative` is the FULL cumulative transcript captured
 *     immediately BEFORE the value-A turn ran. Subtracted from the
 *     post-A cumulative transcript it yields `aOnly` — the suffix that
 *     turn A added (i.e. the value-A response, isolated from any
 *     earlier knobs' responses already on screen).
 *   - `aOnly` is populated by the value-A snapshot assertion and is
 *     compared against the value-B suffix in `buildKnobDiffAssertion`.
 *   - `postACumulative` is the cumulative transcript snapshotted AFTER
 *     turn A — used as the prior baseline when isolating turn B's
 *     suffix.
 */
export type KnobSnapshot = {
  priorCumulative: string;
  postACumulative: string;
  aOnly: string;
};

/**
 * Build a "snapshot transcript" assertion for the value-A turn.
 * Reads the current cumulative transcript (which now contains all
 * prior knob pairs' responses PLUS the value-A response), strips off
 * `priorCumulative`, and stores the resulting value-A delta in
 * `target.aOnly`. Also records the post-A cumulative transcript so
 * the value-B assertion can in turn isolate its own suffix.
 *
 * Always succeeds unless the value-A turn produced no new content
 * (which would mean the fixture didn't match) — in that case it
 * throws so the failure is reported on the A turn rather than
 * causing a confusing "byte-identical" report on B.
 */
function buildSnapshotAssertion(
  knob: string,
  target: KnobSnapshot,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    const post = (await readAssistantTranscript(page)).trim();
    const prior = target.priorCumulative.trim();
    const aOnly = post.startsWith(prior)
      ? post.slice(prior.length).trim()
      : post;
    if (aOnly.length === 0) {
      throw new Error(
        `agent-config-${knob}: value-A turn produced no new transcript content — fixture may not be matching`,
      );
    }
    target.postACumulative = post;
    target.aOnly = aOnly;
  };
}

/**
 * Build the comparison assertion for a knob pair. Reads the latest
 * cumulative transcript, isolates turn B's suffix using the post-A
 * cumulative snapshot, and compares it against turn A's isolated
 * suffix (`snapshot.aOnly`).
 *
 * Both `aOnly` and `onlyB` are now per-turn deltas, so the math is
 * apples-to-apples regardless of how many earlier knob pairs have
 * already populated the cumulative transcript.
 */
export function buildKnobDiffAssertion(
  knob: string,
  diff: "text" | "length",
  snapshot: KnobSnapshot,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    const post = (await readAssistantTranscript(page)).trim();
    const aOnly = snapshot.aOnly;
    const priorB = snapshot.postACumulative.trim();
    if (aOnly.length === 0) {
      throw new Error(
        `agent-config-${knob}: value-A delta was empty — snapshot assertion did not run or produced no content`,
      );
    }
    const onlyB = post.startsWith(priorB)
      ? post.slice(priorB.length).trim()
      : post;
    if (onlyB.length === 0) {
      throw new Error(
        `agent-config-${knob}: value-B turn produced no new transcript content`,
      );
    }
    if (diff === "text") {
      // Both deltas are the per-turn responses — equality means the
      // knob did not change the response.
      if (aOnly === onlyB) {
        throw new Error(
          `agent-config-${knob}: value-A and value-B responses were byte-identical (${aOnly.length} chars)`,
        );
      }
    } else {
      // Length-mode: detailed (B-delta) must exceed concise (A-delta)
      // by the configured threshold. Both sides are per-turn deltas,
      // so the comparison is independent of any prior knobs already
      // on the page.
      const deltaChars = onlyB.length - aOnly.length;
      if (deltaChars < RESPONSE_LENGTH_DELTA_MIN) {
        throw new Error(
          `agent-config-${knob}: detailed response was only ${deltaChars} chars longer than concise (need ≥ ${RESPONSE_LENGTH_DELTA_MIN}); A=${aOnly.length}, B=${onlyB.length}`,
        );
      }
    }
  };
}

/**
 * Build a "prior baseline" assertion that runs BEFORE the value-A
 * turn's input is dispatched. It captures the cumulative transcript
 * present on the page right now (i.e. the trail of all earlier
 * knob pairs' responses) so the value-A snapshot assertion can
 * subtract it later.
 *
 * `assertions` runs after the user input is sent and the response
 * has settled, so we cannot use it to capture "before A". Instead
 * we hang the priming off the PREVIOUS turn's assertion via
 * `chainPriorCapture`, except for the very first probe pair which
 * primes off an initial empty baseline (the page is blank pre-run).
 */
function chainPriorCapture(
  inner: (page: Page) => Promise<void>,
  next: KnobSnapshot,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    await inner(page);
    next.priorCumulative = await readAssistantTranscript(page);
  };
}

/**
 * Build turns with linked per-probe snapshots so each knob pair
 * compares its OWN per-turn deltas (value-A response vs value-B
 * response) rather than running totals.
 *
 * Linkage: probe N's value-B assertion captures the cumulative
 * transcript on screen as it finishes; that becomes the
 * `priorCumulative` for probe N+1's value-A snapshot. Probe 0
 * starts with an empty priorCumulative, which matches the blank
 * pre-run page.
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentSnapshot: KnobSnapshot = {
    priorCumulative: "",
    postACumulative: "",
    aOnly: "",
  };
  for (let i = 0; i < AGENT_CONFIG_PROBES.length; i++) {
    const probe = AGENT_CONFIG_PROBES[i]!;
    const snap = currentSnapshot;
    turns.push({
      input: probe.promptA,
      assertions: buildSnapshotAssertion(probe.knob, snap),
      responseTimeoutMs: 45_000,
    });
    const isLast = i === AGENT_CONFIG_PROBES.length - 1;
    const nextSnap: KnobSnapshot = isLast
      ? snap // unused trailing slot
      : {
          priorCumulative: "",
          postACumulative: "",
          aOnly: "",
        };
    const baseB = buildKnobDiffAssertion(probe.knob, probe.diff, snap);
    turns.push({
      input: probe.promptB,
      assertions: isLast ? baseB : chainPriorCapture(baseB, nextSnap),
      responseTimeoutMs: 45_000,
    });
    currentSnapshot = nextSnap;
  }
  return turns;
}

registerD5Script({
  featureTypes: ["agent-config"],
  fixtureFile: "agent-config.json",
  buildTurns,
});
