/**
 * Learning operations behind the contract routes. SERVER-ONLY.
 */

import * as ledger from "../data/store";
import * as store from "./store";
import { deriveFallback, deriveWithLlm } from "./learn";
import type { Learned } from "./learn";
import type { EvalCandidate, Skill } from "./types";
import { SKILL_NAME } from "./types";

export class LearningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

function nextRevision(): number {
  const existing = store.getSkill(SKILL_NAME);
  return existing ? existing.revision + 1 : 1;
}

function apply(learned: Learned): void {
  const s = store.state();
  s.insights = learned.insights;
  for (const skill of learned.skills) {
    const i = s.skills.findIndex((x) => x.name === skill.name);
    if (i >= 0) s.skills[i] = skill;
    else s.skills.push(skill);
  }
  s.evalCandidates = learned.evalCandidates;
}

/** POST /learn: learn over the latest trajectory the agent failed and a person completed. */
export async function learn(opts: { llm?: boolean } = {}): Promise<Learned> {
  const d = store.learnableTrajectory();
  if (!d) {
    throw new LearningError(
      "NO_TRAJECTORY",
      "No product trajectory has been captured yet. Try the request with the agent, then complete it by hand in Ledgerline.",
    );
  }
  let learned: Learned;
  try {
    learned =
      opts.llm === false
        ? deriveFallback(d, nextRevision(), Date.now(), "fallback requested")
        : await deriveWithLlm(d, nextRevision());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("NO_FIX_CAPTURED")) {
      throw new LearningError(
        "NO_FIX_CAPTURED",
        message.replace(/^NO_FIX_CAPTURED:\s*/, ""),
      );
    }
    throw error;
  }
  apply(learned);
  return learned;
}

/**
 * Publish a skill. Approving one that was never learned (the prototype can run
 * on sample data) learns it first with the deterministic path, so the agent
 * always gets a real SKILL.md.
 */
export async function approveSkill(name: string): Promise<Skill> {
  let skill = store.getSkill(name);
  if (!skill && name === SKILL_NAME) {
    const d = store.learnableTrajectory();
    if (d) {
      try {
        apply(deriveFallback(d, nextRevision()));
      } catch {
        // No fix captured: fall through to the canonical skill below.
      }
    }
    skill = store.getSkill(name) ?? canonicalSkill();
    if (!store.getSkill(name)) store.state().skills.push(skill);
  }
  if (!skill)
    throw new LearningError("NOT_FOUND", `There is no skill ${name}.`, 404);
  skill.status = "published";
  skill.updatedAt = Date.now();
  return skill;
}

export function disableSkill(name: string): Skill {
  const skill = store.getSkill(name);
  if (!skill)
    throw new LearningError("NOT_FOUND", `There is no skill ${name}.`, 404);
  skill.status = "disabled";
  skill.updatedAt = Date.now();
  return skill;
}

export function reviewEvalCandidate(
  id: string,
  decision: unknown,
): EvalCandidate {
  if (decision !== "accepted" && decision !== "rejected") {
    throw new LearningError(
      "BAD_DECISION",
      'decision must be "accepted" or "rejected".',
      400,
    );
  }
  const c = store.state().evalCandidates.find((x) => x.id === id);
  if (!c)
    throw new LearningError(
      "NOT_FOUND",
      `There is no eval candidate ${id}.`,
      404,
    );
  c.status = decision;
  return c;
}

/** POST /reset: seed ledger, seed history, no capture from today, no learned output. */
const RESET_AT = Symbol.for("ledgerline.learning.resetAt");
type ResetClock = { [RESET_AT]?: number };

export function resetAll(): void {
  ledger.reset();
  store.reset();
  (globalThis as ResetClock)[RESET_AT] = Date.now();
}

/**
 * When the demo was last fully reset (epoch ms), or null since the server
 * started. The chat's thread rail hides older conversations, because without
 * Intelligence the runtime cannot delete them.
 */
export function lastResetAt(): number | null {
  return (globalThis as ResetClock)[RESET_AT] ?? null;
}

/** The skill as the deterministic path writes it, for an approve that arrives before any capture. */
function canonicalSkill(): Skill {
  const description =
    "Use when approving an expense report blocked by POLICY_HOLD POL-114 (allocation required): a Team event report over $2,500 whose event lines are still coded to a department cost center.";
  const md = [
    "---",
    `name: ${SKILL_NAME}`,
    `description: ${description}`,
    "---",
    "",
    "# Approve a team-event expense report",
    "",
    "## When to use",
    'approveReport returns POLICY_HOLD POL-114, or you are about to approve a Team event report over $2,500. Policy POL-114 says: "Team events over $2,500 must be coded to the cost center that owns the events budget." That cost center is CC-410 Events & Offsites.',
    "",
    "## Steps",
    '1. Call getReport to confirm the category is "Team event", the total is over $2,500 and hold POL-114 is open, and to read the lineIds.',
    '2. Call recodeLines to recode only the event lines (venue hire and catering) to "CC-410" (Events & Offsites), the events-budget cost center. Leave the other lines (transport, supplies) on their current cost center.',
    "3. Approve it: approveAndReimburse when the user also asked for reimbursement (one confirmation card), otherwise approveReport. Approval succeeds once the hold resolves.",
    "4. If you used approveReport and the user asked for reimbursement, call reimburseReport.",
    "5. Confirm in one sentence: the report, the amount, and which lines moved to CC-410 Events & Offsites.",
    "",
    "## Guardrails",
    "- Recode only event spend (venue, catering) to CC-410. Recoding every line, or using another cost center, does not clear POL-114.",
    "- Do not add notes or retry approval as a workaround for this hold; the line coding is what clears it.",
    "",
  ].join("\n");
  return {
    name: SKILL_NAME,
    status: "candidate",
    description,
    skillMd: md,
    supportingInsightIds: [],
    revision: 1,
    updatedAt: Date.now(),
  };
}
