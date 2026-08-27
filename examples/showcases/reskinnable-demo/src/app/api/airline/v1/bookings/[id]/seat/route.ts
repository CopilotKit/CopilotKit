import * as store from "@/skins/airline/data/store";
import {
  jsonError,
  readJsonObject,
  resolveBookingOr404,
} from "@/skins/airline/data/route-helpers";
import { SEAT_PREFERENCES } from "@/skins/airline/data/handling";

/**
 * BEAT 5, step 2 — move the passenger to a seat matching a preference.
 *
 * The CALLER names a preference, never a seat. The server picks, from the seats
 * actually free on whatever itinerary the booking is on now (its original
 * flight, or the option it was reissued onto). Letting the caller name the seat
 * would let a model invent one, and a booking confirming a seat that does not
 * exist is exactly the confident falsehood this app fails toward.
 *
 * It REFUSES rather than approximating: a preference with nothing free comes
 * back `NO_SEAT_AVAILABLE` and the passenger keeps the seat they had. A reseat
 * that quietly lands them in a middle seat and reports success would be worse
 * than doing nothing.
 *
 * ⚠️ This vocabulary is GIVEN to the agent — `SEAT_PREFERENCES` is enumerated in
 * the refusal below on purpose. There is nothing to discover in beat 5; the
 * whole claim is that the assistant already knows the procedure. That is the
 * exact opposite of beat 6's catalogue, and the contrast is the point.
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

  const preference = typeof body.preference === "string" ? body.preference : "";
  const result = store.reseatBooking(found.booking, preference);

  if (!result.ok) {
    if (result.error === "INVALID_PREFERENCE") {
      return jsonError(
        "INVALID_PREFERENCE",
        `Seat preferences are: ${SEAT_PREFERENCES.join(", ")}.`,
        422,
      );
    }
    return jsonError(
      "NO_SEAT_AVAILABLE",
      `No ${preference} seat is free on this itinerary; the seat is unchanged.`,
      422,
    );
  }

  return Response.json({
    booking: store.toDto(found.booking),
    seat: result.seat,
    preference: result.preference,
  });
};
