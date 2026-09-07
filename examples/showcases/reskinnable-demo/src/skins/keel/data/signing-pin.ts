/**
 * BEAT 3a — the operator's e-signature PIN, which the agent must never see.
 *
 * Releasing a policy revision to the workforce is a SIGNED act at Harbor Point:
 * the register records who put that text in front of every employee. Clinical
 * systems already work this way (e-prescribing, chart co-signature), so the room
 * recognises the box without being told what it is for.
 *
 * One helper returns BOTH the guidance the card prints and the predicate its
 * submit button compares against, because a card that prints a rule it will not
 * accept is worse than a wrong rule: the presenter follows the app's own
 * instruction on stage and the app refuses, with nothing on screen saying why.
 *
 * And it REFUSES what it cannot read rather than rewriting it. On this beat the
 * typed value IS the write, so a parser that strips unrecognised characters
 * (`typed.replace(/[^0-9]/g, "")`) silently turns "-482913" into a valid
 * countersignature — correct length, all digits, nothing downstream able to
 * catch it. "Nothing typed yet" is a separate flag so an untouched field is not
 * scolded.
 *
 * ⚠️ WHAT THE PIN IS, AND WHAT IT IS NOT. It is a SECOND FACTOR on a release the
 * operator is ALREADY authorized to make — it confirms WHO is acting, never
 * WHICH revisions may go out. `checkReleaseAuthority()` stays the only thing
 * between an unendorsed revision and the workforce; if a PIN could release one,
 * it would be a second unlock path around beat 6's variance gate, the agent
 * would take it, the teach arc would silently never fire, and NOTHING would
 * fail. The server-side half of that separation is asserted in
 * `src/app/api/keel/v1/countersignatures/route.test.ts`.
 *
 * ⚠️ PIN VALIDITY IS FORMAT-ONLY, BY DESIGN — READ THIS BEFORE TRUSTING IT.
 * There is no secret to match against: no persona carries a PIN or a digest, so
 * ANY six digits are accepted, for any operator. `readSigningPin` checks the
 * SHAPE and nothing else, and a refusal means "not six digits", never "wrong
 * PIN". That is deliberate for a stage demo — a memorised number is a thing to
 * fumble in front of a room — and the beat's claim is about WHERE the value
 * travels (never into the transcript), not about authenticating anyone. Nothing
 * here is an authentication control. If this app ever needs a genuine second
 * factor, that is a per-persona secret plus a constant-time comparison, and this
 * paragraph is the thing to delete.
 *
 * SERVER-SAFE by construction — plain TypeScript, no React, no "use client" — so
 * the countersignature route validates the typed string with the SAME predicate
 * the card compared against, rather than a second copy of the rule.
 */

const PIN_LENGTH = 6;

export type PinVerdict =
  | { ok: true; pin: string }
  | { ok: false; untouched: true }
  | { ok: false; reason: string };

export function signingPinGuidance(): { hint: string; length: number } {
  return {
    length: PIN_LENGTH,
    hint: `Your ${PIN_LENGTH}-digit e-signature PIN`,
  };
}

export function readSigningPin(typed: string): PinVerdict {
  const text = typed.trim();
  if (text === "") return { ok: false, untouched: true };
  if (!/^[0-9]+$/.test(text)) {
    return {
      ok: false,
      reason: `The e-signature PIN is ${PIN_LENGTH} digits — numbers only.`,
    };
  }
  if (text.length !== PIN_LENGTH) {
    return {
      ok: false,
      reason: `The e-signature PIN is exactly ${PIN_LENGTH} digits.`,
    };
  }
  return { ok: true, pin: text };
}
