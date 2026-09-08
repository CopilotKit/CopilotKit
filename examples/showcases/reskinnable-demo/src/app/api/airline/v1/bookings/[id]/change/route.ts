import * as store from "@/skins/airline/data/store";
import {
  jsonError,
  readJsonObject,
  resolveBookingOr404,
} from "@/skins/airline/data/route-helpers";
import {
  amountDueUsd,
  checkFareChange,
  formatUsd,
} from "@/skins/airline/data/fare-rules";
import { findOption } from "@/skins/airline/data/rebooking-options";

/**
 * BEAT 6's GATE, and BEAT 5's first write — reissue a booking onto another
 * option.
 *
 * ⚠️ THE REFUSAL NAMES THE FARE CONDITION AND NOTHING ELSE. Not the word
 * "exception", not a category, not "ask an agent". The way through is the thing
 * the passenger demonstrates and the agent has to learn, and a 422 body is one
 * of the five channels that leak a gate's vocabulary (failure-modes § 10). The
 * message comes from `checkFareChange` verbatim so there is one place to keep
 * honest.
 *
 * ⚠️ EVERY FIGURE IS RECOMPUTED. A client-supplied fare difference, change fee
 * or total is ignored outright — the body carries an option id and nothing more.
 * A gate that trusts the caller's arithmetic is theater.
 *
 * ORDER IS LOAD-BEARING. The fare check runs BEFORE the money check, so a
 * non-changeable ticket refuses with `FARE_NOT_CHANGEABLE` rather than with
 * `PAYMENT_REQUIRED` — otherwise the gate's symptom would be a bill, and the
 * passenger would learn to reach for their card instead of for the procedure.
 *
 * WHY THIS ROUTE WILL NOT TAKE MONEY. When something is due it stops and says
 * so; `POST /authorizations` is the only path that commits a paid change,
 * because that is where the card confirmation arrives. If this route could
 * commit a paid change on its own, beat 3a's card would be decoration.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await readJsonObject(req);
  if (!body) return jsonError("BAD_REQUEST", "A JSON body is required.", 400);

  const found = resolveBookingOr404(id);
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

  const check = checkFareChange({
    booking,
    flight,
    exceptions: store.exceptions(),
  });
  if (!check.allowed) {
    return jsonError(check.code, check.message, 422);
  }

  const due = amountDueUsd(booking, option, check.permission);
  if (due > 0) {
    return Response.json(
      {
        error: "PAYMENT_REQUIRED",
        message:
          `${formatUsd(due)} is due to move ${booking.reference} onto ` +
          `${option.flightNumber}. Confirm the card on file to complete it.`,
        amountDueUsd: due,
        optionId: option.id,
      },
      { status: 402 },
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
