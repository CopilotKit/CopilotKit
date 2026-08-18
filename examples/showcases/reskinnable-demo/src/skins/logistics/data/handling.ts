/**
 * BEAT 5 — the closed vocabularies the stored procedure's three writes use.
 *
 * These are the OPPOSITE of `escalation-codes.ts` and the contrast is the point:
 *
 *  - `escalation-codes.ts` is beat 6's gate vocabulary and is WITHHELD from the
 *    agent. The agent has to learn which code works by watching the planner.
 *  - This file is beat 5's PROCEDURE vocabulary and is deliberately GIVEN to the
 *    agent, enumerated on the tool schemas, because the whole claim of beat 5 is
 *    that it already knows the procedure. There is nothing to discover here.
 *
 * Keeping them in separate modules is what stops a future edit reaching for
 * "the codes file" and importing the withheld one into `tools.tsx`. Note the
 * identifiers below end in `_REASONS` / `_MESSAGES` / `_LABELS` rather than
 * `_CODES`, so `eslint.config.mjs`'s `withheldGateVocabulary` selector
 * (`/_(CODE_LABELS|CODES)$/`) does not match them — which is correct, and is
 * also why the naming is not a free choice.
 *
 * Neither vocabulary uses the word "escalation": beat 5's procedure and beat 6's
 * unlock are the single easiest pair in this demo for the model to confuse, and
 * a shared word in the tool schemas is a standing invitation to do it.
 */

/** Why a shipment was put on the tower's watch list. */
export const WATCH_REASONS = [
  "carrier-silent",
  "promise-breached",
  "documents-rejected",
  "cargo-integrity",
] as const;

export type WatchReason = (typeof WATCH_REASONS)[number];

/** Human copy for the watch badge. Read aloud on stage, so full sentences. */
export const WATCH_REASON_LABELS: Record<WatchReason, string> = {
  "carrier-silent": "Carrier has gone silent",
  "promise-breached": "Promised date already broken",
  "documents-rejected": "Documents rejected in transit",
  "cargo-integrity": "Cargo integrity in question",
};

export const isWatchReason = (value: string): value is WatchReason =>
  (WATCH_REASONS as readonly string[]).includes(value);

/** The templated messages the tower can send a carrier. */
export const CARRIER_MESSAGES = [
  "status-request",
  "recovery-plan",
  "late-notice",
] as const;

export type CarrierMessage = (typeof CARRIER_MESSAGES)[number];

export const CARRIER_MESSAGE_LABELS: Record<CarrierMessage, string> = {
  "status-request": "Where is it — status requested",
  "recovery-plan": "Written recovery plan requested",
  "late-notice": "Formal late notice served",
};

export const isCarrierMessage = (value: string): value is CarrierMessage =>
  (CARRIER_MESSAGES as readonly string[]).includes(value);

/**
 * The marker every procedure note carries.
 *
 * "Make sure that you use like a light or a bell or whatever so people can see
 * that it changed" — a note that reads like every other note is invisible from
 * the back of a room, so the marker is FORCED here rather than left to the
 * model's discretion, exactly as banking forces it on `addNoteToTransaction`.
 * Idempotent: a model that already prefixed one does not get two.
 */
export const NOTE_MARKER = "🚨";

export const markNote = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.startsWith(NOTE_MARKER)
    ? trimmed
    : `${NOTE_MARKER} ${trimmed}`;
};
