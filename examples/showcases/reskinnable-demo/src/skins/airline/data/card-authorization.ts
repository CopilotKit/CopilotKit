/**
 * BEAT 3a — the card confirmation the agent must never see.
 *
 * The passenger is making a PAID change: a fare difference, plus whatever change
 * fee their fare charges. Aeronova asks them to confirm the card on file by its
 * last four digits, and they type those into a card IN THE CHAT. The digits go
 * straight to `POST /authorizations`; the agent's `respond()` only ever receives
 * the sentence the card composes afterwards, and no response body echoes what
 * was typed — a refusal says "not accepted", never the value.
 *
 * ONE HELPER RETURNS BOTH the guidance the card prints and the predicate its
 * submit button compares against, because a card that prints a figure it will
 * not accept is worse than a wrong number: the presenter follows the app's own
 * instruction on stage and the app refuses, with nothing on screen saying why.
 *
 * AND IT REFUSES WHAT IT CANNOT READ rather than rewriting it. On this beat the
 * typed value IS the write, so a parser that strips unrecognised characters
 * (`Number(typed.replace(/[^0-9]/g, ""))`) silently turns "-4417" and "4 4 1 7"
 * into accepted confirmations. "Nothing typed yet" is a SEPARATE flag so an
 * untouched field is not scolded.
 *
 * ⚠️ THE CARD IS A SECOND FACTOR, NEVER AN ENTITLEMENT OVERRIDE. It confirms WHO
 * is paying; it never changes WHAT THE FARE PERMITS. `POST /authorizations` runs
 * the SAME `checkFareChange()` the ordinary change route runs, on figures it
 * recomputes itself, so a valid confirmation on a non-changeable fare is still
 * `FARE_NOT_CHANGEABLE`. If the card could release one it would be a second door
 * around beat 6's gate: the agent would route around the gate, the teach arc
 * would never fire, and NOTHING would fail —
 * `src/app/api/airline/v1/authorizations/route.test.ts` pins that separation,
 * and it is the only symptom the failure has.
 *
 * ⚠️ VALIDITY IS FORMAT-ONLY, BY DESIGN — READ THIS BEFORE TRUSTING IT. There is
 * no secret to match against: no card number or digest exists anywhere in this
 * substrate (the profile publishes `paymentCardLabel`, a brand and dots), so ANY
 * four digits are accepted. `readCardLast4` checks the SHAPE and nothing else,
 * and `INVALID_CARD_CONFIRMATION` means "not four digits", never "wrong card".
 * That is deliberate for a stage demo — a memorized number is a thing to fumble
 * on stage, and the beat's claim is about WHERE the value travels, not about
 * authenticating anyone. Nothing here is an authentication control; the real
 * control on that route is `checkFareChange()`. If this app ever needs a genuine
 * second factor, that is a stored digest plus a constant-time comparison, and
 * this paragraph is the thing to delete.
 *
 * Server-safe by construction — plain TypeScript, no React, no `"use client"` —
 * so the authorization route validates the typed string with the SAME predicate
 * the card compared against, rather than a second copy of the rule.
 */

const LAST4_LENGTH = 4;

export type CardVerdict =
  | { ok: true; last4: string }
  | { ok: false; untouched: true }
  | { ok: false; reason: string };

export interface CardGuidance {
  /** The sentence the card prints above the field. */
  hint: string;
  /** How many digits the predicate below actually accepts. */
  length: number;
}

/**
 * The guidance the card prints — derived from the same constant the predicate
 * compares against, so the two cannot drift.
 *
 * `cardLabel` is the ledger's `paymentCardLabel` ("Visa ending in ••••"), which
 * carries a brand and dots and NEVER digits. Passing it through here is what
 * lets the card name the right card without putting the secret on screen.
 */
export function cardConfirmationGuidance(cardLabel: string): CardGuidance {
  return {
    length: LAST4_LENGTH,
    hint: `Confirm the last ${LAST4_LENGTH} digits of your ${cardLabel.trim()}`,
  };
}

/**
 * Read what the passenger typed.
 *
 * Tolerates surrounding whitespace and nothing else. A sign, a separator, an
 * exponent, a decimal point or a letter is a REFUSAL with a sentence the card
 * can say out loud — not a value quietly repaired into something acceptable.
 */
export function readCardLast4(typed: string): CardVerdict {
  const text = typed.trim();
  if (text === "") return { ok: false, untouched: true };
  if (!/^[0-9]+$/.test(text)) {
    return {
      ok: false,
      reason: `Enter the last ${LAST4_LENGTH} digits of the card — numbers only.`,
    };
  }
  if (text.length !== LAST4_LENGTH) {
    return {
      ok: false,
      reason: `That is ${text.length} digits; the card confirmation is exactly ${LAST4_LENGTH}.`,
    };
  }
  return { ok: true, last4: text };
}
