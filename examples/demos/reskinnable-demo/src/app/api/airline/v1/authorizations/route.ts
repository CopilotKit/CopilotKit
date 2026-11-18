import * as store from "@/skins/airline/data/store";
import {
  jsonError,
  readJsonObject,
  resolveBookingOr404,
} from "@/skins/airline/data/route-helpers";
import { readCardLast4 } from "@/skins/airline/data/card-authorization";
import { amountDueUsd, checkFareChange } from "@/skins/airline/data/fare-rules";
import { findOption } from "@/skins/airline/data/rebooking-options";

/**
 * BEAT 3a — the card-confirmed paid change.
 *
 * The passenger types the last four digits of the card on file into a card in
 * the chat and this route receives them directly; the agent's `respond()` only
 * ever gets the sentence the card composes afterwards. The digits are never
 * echoed in any response body — a refusal says "not accepted", never what was
 * typed.
 *
 * ⚠️ THE CARD IS A SECOND FACTOR, NOT AN ENTITLEMENT OVERRIDE. It confirms WHO
 * is paying; it never changes WHAT THE FARE PERMITS. So this route runs the SAME
 * `checkFareChange()` as `/bookings/:id/change`, on figures it recomputes
 * itself, and a valid card confirmation on a non-changeable fare is still
 * `FARE_NOT_CHANGEABLE`. If the card could release one it would be a second door
 * around beat 6's gate: the agent would route around the gate, the teach arc
 * would never fire, and NOTHING would fail. `route.test.ts` pins that
 * separation; it is the only symptom the failure has.
 *
 * AND THE SEPARATION IS STRUCTURALLY STRONGER HERE THAN IN LOGISTICS, which is
 * worth knowing before anyone "simplifies" it. Logistics gates on an AMOUNT, so
 * the option the caller names decides whether its gate fires — hence
 * failure-modes § 12's rule that the agent must not pick the option. Aeronova
 * gates on the FARE, so no choice of option can slip past it: every option on a
 * non-changeable booking is refused, which the test asserts by walking all of
 * them rather than hardcoding one.
 *
 * ⚠️ CARD VALIDITY IS FORMAT-ONLY, BY DESIGN. No card digits exist anywhere in
 * this substrate, so ANY four digits are accepted — see
 * `data/card-authorization.ts` for why that is deliberate and what would have to
 * change if it ever needed to be real. Nothing here is an authentication
 * control; the real control on this route is `checkFareChange()`.
 */
export const POST = async (req: Request) => {
  const body = await readJsonObject(req);
  if (!body) return jsonError("BAD_REQUEST", "A JSON body is required.", 400);

  // THE CARD IS CHECKED FIRST, before anything that reads the ledger. It is only
  // a format check, but the 404 and 422 below are ANSWERS: they tell an
  // unauthenticated caller which bookings exist and which options are available
  // on them. Refusing an unreadable request before consulting the store means
  // those answers are never handed out for free. The SAME predicate the card's
  // submit button compared against — imported, not restated, so the server
  // cannot drift into accepting a shape the card refuses (or refusing one it
  // invited).
  const verdict = readCardLast4(
    typeof body.cardLast4 === "string" ? body.cardLast4 : "",
  );
  if (!verdict.ok) {
    return jsonError(
      // Never echo what was typed.
      "INVALID_CARD_CONFIRMATION",
      "That card confirmation was not accepted.",
      401,
    );
  }

  const ref = typeof body.booking === "string" ? body.booking : "";
  const found = resolveBookingOr404(ref);
  if (!found.ok) return found.response;
  const booking = found.booking;

  if (booking.status !== "ticketed") {
    return jsonError(
      "ALREADY_CHANGED",
      `${booking.reference} has already been reissued.`,
      409,
    );
  }

  const flight = store.flightFor(booking);
  if (!flight) {
    return jsonError("NOT_FOUND", "That booking's flight is missing.", 404);
  }

  const optionId = typeof body.optionId === "string" ? body.optionId : "";
  const option = findOption(store.options(), optionId);
  if (!option || option.bookingId !== booking.id) {
    return jsonError(
      "UNAVAILABLE_OPTION",
      `That is not an available option for ${booking.reference}.`,
      422,
    );
  }

  // ── THE GATE. Identical to the ordinary change route's, deliberately. ─────
  const check = checkFareChange({
    booking,
    flight,
    exceptions: store.exceptions(),
  });
  if (!check.allowed) {
    return jsonError(check.code, check.message, 422);
  }

  // Recomputed here, exactly as the change route does: any amount in the body is
  // ignored, or the authorization would be for a number the caller chose.
  const due = amountDueUsd(booking, option, check.permission);
  if (due <= 0) {
    // Asking for a card to move $0 is a formality dressed up as an
    // authorization — the same bug logistics' $0 `absorb` option produced. Say
    // so, and let the ordinary change route commit it.
    return jsonError(
      "NOTHING_DUE",
      `Nothing is due to move ${booking.reference} onto ` +
        `${option.flightNumber}; no card confirmation is needed.`,
      422,
    );
  }

  const reissue = store.reissueBooking(booking, option, due, check.permission);
  return Response.json({
    booking: store.toDto(booking),
    reissue,
    permission: check.permission,
    amountPaidUsd: due,
  });
};
