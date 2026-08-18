import * as store from "@/skins/airline/data/store";
import { resolveBookingOr404 } from "@/skins/airline/data/route-helpers";
import { checkFareChange } from "@/skins/airline/data/fare-rules";

/**
 * One booking, by its id or its PNR, with the flight and traveler it belongs to.
 *
 * `changeable` is included because it is the one fact about a booking that
 * nothing else on the wire states — and it is DERIVED from the same
 * `checkFareChange` the write path runs, so this read can never advertise a
 * change the gate would refuse (or hide one it would allow).
 *
 * ⚠️ `refusal` carries the gate's own message when the fare refuses, and that
 * message names the FARE CONDITION only. It must never grow a hint about
 * exceptions, categories or documentation — see `fare-rules.ts`.
 */
export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const found = resolveBookingOr404(id);
  if (!found.ok) return found.response;

  const booking = found.booking;
  const flight = store.flightFor(booking);
  if (!flight) {
    return Response.json(
      { error: "NOT_FOUND", message: "That booking's flight is missing." },
      { status: 404 },
    );
  }

  const check = checkFareChange({
    booking,
    flight,
    exceptions: store.exceptions(),
  });

  return Response.json({
    booking: store.toDto(booking),
    flight,
    traveler: store.travelerFor(booking) ?? null,
    changeable: check.allowed,
    permission: check.allowed ? check.permission : null,
    refusal: check.allowed ? null : check.message,
  });
};
