/**
 * BEAT 5 — the closed vocabularies the stored procedure's three writes use.
 *
 * These are the OPPOSITE of `variance-codes.ts` and the contrast is the point:
 *
 *  - `variance-codes.ts` is beat 6's gate vocabulary and is WITHHELD from the
 *    agent. The agent has to learn which code works by watching the operator.
 *  - This file is beat 5's PROCEDURE vocabulary and is deliberately GIVEN to the
 *    agent, enumerated on the tool schemas, because the whole claim of beat 5 is
 *    that it already knows the procedure. There is nothing to discover here, so
 *    a refusal from these sets DOES name the valid values — withholding them
 *    would only cost a round trip.
 *
 * Keeping them in separate modules is what stops a future edit reaching for "the
 * codes file" and importing the withheld one into `tools.tsx`. Note the
 * identifiers below end in `_REASONS` / `_TEMPLATES` / `_LABELS` rather than
 * `_CODES`, so `eslint.config.mjs`'s `withheldGateVocabulary` selector
 * (`/_(CODE_LABELS|CODES)$/`) does not match them — which is correct, and is
 * also why the naming is not a free choice.
 *
 * Neither vocabulary uses the word "variance" or "release": beat 5's procedure
 * and beat 6's unlock are the single easiest pair in this demo for the model to
 * confuse, and a shared word in the tool schemas is a standing invitation.
 */

/** Why a document was put on the desk's review list. */
export const REVIEW_FLAG_REASONS = [
  "review-overdue",
  "regulatory-change",
  "incident-followup",
  "content-conflict",
] as const;

export type ReviewFlagReason = (typeof REVIEW_FLAG_REASONS)[number];

/** Human copy for the flag badge. Read aloud on stage, so full sentences. */
export const REVIEW_FLAG_REASON_LABELS: Record<ReviewFlagReason, string> = {
  "review-overdue": "Past its scheduled review date",
  "regulatory-change": "External requirement has changed",
  "incident-followup": "Follow-up from a reported incident",
  "content-conflict": "Conflicts with another document in force",
};

export const isReviewFlagReason = (value: string): value is ReviewFlagReason =>
  (REVIEW_FLAG_REASONS as readonly string[]).includes(value);

/** The templated notices the desk can send a document's owning department. */
export const OWNER_NOTICE_TEMPLATES = [
  "review-due",
  "evidence-request",
  "attestation-push",
  "retirement-notice",
] as const;

export type OwnerNoticeTemplate = (typeof OWNER_NOTICE_TEMPLATES)[number];

export const OWNER_NOTICE_TEMPLATE_LABELS: Record<OwnerNoticeTemplate, string> =
  {
    "review-due": "Review is due — please confirm or revise",
    "evidence-request": "Supporting evidence requested",
    "attestation-push": "Outstanding attestations chased",
    "retirement-notice": "Proposed for retirement",
  };

export const isOwnerNoticeTemplate = (
  value: string,
): value is OwnerNoticeTemplate =>
  (OWNER_NOTICE_TEMPLATES as readonly string[]).includes(value);

/**
 * The marker every procedure note carries.
 *
 * "Make sure that you use like a light or a bell or whatever so people can see
 * that it changed" — a note that reads like every other note is invisible from
 * the back of a room, so the marker is FORCED here rather than left to the
 * model's discretion, exactly as banking forces it on `addNoteToTransaction` and
 * logistics on `addShipmentNote`. Idempotent: a model that already prefixed one
 * does not get two.
 */
export const NOTE_MARKER = "🚨";

export const markNote = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.startsWith(NOTE_MARKER)
    ? trimmed
    : `${NOTE_MARKER} ${trimmed}`;
};
