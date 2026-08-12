/**
 * The closed catalogue of FARE WAIVER categories — three tiers.
 *
 *  - JUSTIFYING (4): can lift the fare gate once approved, PROVIDED the
 *    booking's record documents the matching circumstance (see `GROUND_BY_CODE`
 *    and `exceptionLifts` below). All four are the real industry grounds.
 *  - DECOYS (3, CHANGED_PLANS + FOUND_LOWER_FARE + ELITE_COURTESY): catalogued
 *    and recorded so the trip record stays honest, but an exception filed under
 *    them releases NOTHING. They are strong precisely because they are what
 *    everyone actually tries — "my plans changed" is the literal truth of every
 *    voluntary change, "I found a cheaper fare" is the commonest real-world
 *    reason and the one no airline honours, and "we're elite, just ask" is the
 *    room's instinct when they hear the passenger is Gold.
 *  - Everything else: rejected at the route WITHOUT enumerating the valid set.
 *
 * ⚠️ THIS VOCABULARY IS WITHHELD FROM THE AGENT (beat 6). It must never appear
 * in a `useAgentContext` readable, a tool-schema `z.enum`, a tool description, a
 * prompt sentence, or a 4xx body. The agent learns which category works by
 * watching the passenger pick one in the human-facing exception form; that is
 * the entire beat. Take a free `z.string()` on the filing tool's code parameter
 * and state the withholding in its `.describe()` — this INVERTS the
 * enumerate-every-closed-set rule followed everywhere else, because for a gate,
 * reaching the model is the defect.
 *
 * ⚠️ THE LINT GUARD DOES NOT COVER THIS SKIN YET. `eslint.config.mjs`'s
 * `withheldGateVocabulary` rule fails the build when a `*_CODES` /
 * `*_CODE_LABELS` identifier reappears in a skin's `tools.tsx` or `agent.ts`,
 * but its `files` glob lists only the skins whose gate has landed. The slot that
 * writes `src/skins/airline/tools.tsx` and `src/skins/airline/agent.ts` MUST
 * append BOTH to that glob — restating the LOCK_SKIN selectors in the same
 * block, because flat-config `rules` are replaced rather than merged — or
 * nothing checks Aeronova. Verify with
 * `npx eslint --print-config src/skins/airline/tools.tsx` and COUNT the
 * selectors. And the rule sees only IDENTIFIERS: a tool `description` or a
 * prompt sentence spelling a category out in prose is a grep-and-read
 * (`.claude/skills/reskin/failure-modes.md` § 10).
 *
 * `FARE_WAIVER_CODE_LABELS` is reserved for the HUMAN-facing exception form. The
 * passenger may see this vocabulary while the agent may not, and that asymmetry
 * is what makes the demonstration a demonstration rather than a guided tour. The
 * form must list justifying categories and decoys TOGETHER, unmarked and in this
 * array's order: do not reorder to group them, and do not add a `justifies` flag
 * to the labels.
 *
 * ⚠️ SHARES NO TOKEN WITH `handling.ts`, ON PURPOSE. That file holds beat 5's
 * vocabulary, which is GIVEN to the agent. Nothing here says "notify", "party",
 * "seat", "aisle", "hotel" or "pickup"; nothing there says "waiver",
 * "exception", "schedule change", "medical", "bereavement" or "military". A
 * future edit reaching for "the codes file" therefore cannot import the withheld
 * one into `tools.tsx` by accident. `fare-waiver-codes.test.ts` asserts the
 * separation both ways.
 *
 * Server-safe: plain TypeScript, no React, no JSX, no `"use client"`.
 */

import type { WaiverGround } from "./trip-types";

export const FARE_WAIVER_CODES = [
  "SCHEDULE_CHANGE_TRIGGERED",
  "CHANGED_PLANS",
  "MEDICAL_DOCUMENTED",
  "FOUND_LOWER_FARE",
  "BEREAVEMENT_DOCUMENTED",
  "ELITE_COURTESY",
  "MILITARY_ORDERS",
] as const;

export type FareWaiverCode = (typeof FARE_WAIVER_CODES)[number];

export const FARE_WAIVER_CODE_LABELS: Record<FareWaiverCode, string> = {
  SCHEDULE_CHANGE_TRIGGERED: "Aeronova moved the flight after ticketing",
  CHANGED_PLANS: "My plans changed (recorded only)",
  MEDICAL_DOCUMENTED: "Documented medical reason, certificate on file",
  FOUND_LOWER_FARE: "I found a lower fare (recorded only)",
  BEREAVEMENT_DOCUMENTED: "Documented bereavement",
  ELITE_COURTESY: "Courtesy for a tier member (recorded only)",
  MILITARY_ORDERS: "Change compelled by military orders",
};

/**
 * Which documented circumstance each justifying category stands on.
 *
 * GROUNDING is what makes the two taught cases genuinely unlike each other. A
 * category alone lifting the gate would mean a demonstration on the first gated
 * booking could be replayed on the second as a memorized literal, and the
 * "different case, handled unaided" claim would be theater. With grounding the
 * learned procedure has to be "read what the booking documents, file the
 * category that matches it, approve it, then retry" — a procedure, not a string.
 *
 * It is also the honest reading: you cannot claim a schedule-change waiver on a
 * flight that never changed, or a medical waiver with no certificate on file.
 *
 * Keyed by the tuple's own member type, so a new justifying category with no
 * ground is a type error rather than a category that silently lifts nothing.
 */
const GROUND_BY_CODE = {
  SCHEDULE_CHANGE_TRIGGERED: "schedule_change",
  MEDICAL_DOCUMENTED: "medical",
  BEREAVEMENT_DOCUMENTED: "bereavement",
  MILITARY_ORDERS: "military",
} as const satisfies Partial<Record<FareWaiverCode, WaiverGround>>;

type JustifyingCode = keyof typeof GROUND_BY_CODE;

const JUSTIFYING = new Set<string>(Object.keys(GROUND_BY_CODE));

export const isValidExceptionCode = (code: string): code is FareWaiverCode =>
  (FARE_WAIVER_CODES as readonly string[]).includes(code);

/**
 * A category the catalogue treats as a real ground. NOT the same question as
 * "does this lift THIS booking" — that is `exceptionLifts`, and conflating the
 * two is how the third seeded booking would stop being unlockable-by-nothing.
 */
export const isJustifyingExceptionCode = (code: string): boolean =>
  JUSTIFYING.has(code);

/**
 * Whether an exception filed under `code` releases a booking whose record
 * documents `ground`.
 *
 * `ground === null` — a booking documenting nothing at all — is released by NO
 * category, justifying or otherwise. That is the seeded `bkg-av1188` case, and
 * it is what makes "the decoys are real" a fact rather than a claim.
 */
export const exceptionLifts = (
  code: string,
  ground: WaiverGround | null,
): boolean =>
  ground !== null &&
  isJustifyingExceptionCode(code) &&
  GROUND_BY_CODE[code as JustifyingCode] === ground;
