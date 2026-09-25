/**
 * BEAT 3a — the planner's approval PIN, which the agent must never see.
 *
 * One helper returns BOTH the guidance the card prints and the predicate its
 * submit button compares against, because a card that prints a figure it will
 * not accept is worse than a wrong number: the presenter follows the app's own
 * instruction on stage and the app refuses, with nothing on screen saying why.
 *
 * And it REFUSES what it cannot read rather than rewriting it. On this beat the
 * typed value IS the write, so a parser that strips unrecognised characters
 * (`Number(typed.replace(/[^0-9]/g, ""))`) silently turns "-482913" into a valid
 * authorization — finite, correct length, nothing downstream able to catch it.
 * "Nothing typed yet" is a separate flag so an untouched field is not scolded.
 *
 * WHAT THE PIN IS, AND WHAT IT IS NOT. It is a SECOND FACTOR on a mitigation the
 * planner is ALREADY authorized to make — it confirms who is acting, never how
 * much they may spend. `checkAuthority()` stays the only thing between a planner
 * and an over-authority spend; if a PIN could release one, it would be a second
 * unlock path around beat 6's escalation gate and the teach arc would silently
 * never fire. The server-side half of that separation is asserted in
 * `src/app/api/logistics/v1/authorizations/route.test.ts`.
 *
 * SERVER-SAFE by construction — plain TypeScript, no React, no "use client" — so
 * the authorization route validates the typed string with the SAME predicate the
 * card compared against, rather than a second copy of the rule.
 */

const PIN_LENGTH = 6;

export type PinVerdict =
  | { ok: true; pin: string }
  | { ok: false; untouched: true }
  | { ok: false; reason: string };

export function plannerPinGuidance(): { hint: string; length: number } {
  return {
    length: PIN_LENGTH,
    hint: `Your ${PIN_LENGTH}-digit approval PIN`,
  };
}

export function readPlannerPin(typed: string): PinVerdict {
  const text = typed.trim();
  if (text === "") return { ok: false, untouched: true };
  if (!/^[0-9]+$/.test(text)) {
    return {
      ok: false,
      reason: `The PIN is ${PIN_LENGTH} digits — numbers only.`,
    };
  }
  if (text.length !== PIN_LENGTH) {
    return { ok: false, reason: `The PIN is exactly ${PIN_LENGTH} digits.` };
  }
  return { ok: true, pin: text };
}
