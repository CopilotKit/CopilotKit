import * as store from "@/skins/airline/data/store";
import { jsonError } from "@/skins/airline/data/route-helpers";

/**
 * BEAT 6, unlock step 2 — approve a filed exception and link it to its booking.
 *
 * Auto-approve; there is no review step in the demo. Linking is NOT the same as
 * lifting: `checkFareChange` still asks `exceptionLifts(code, ground)`, so a
 * decoy category — or a justifying one the booking's record does not support —
 * is approved, linked, visible on the trip, and releases nothing. That is the
 * whole reason the decoys are real: the passenger watches a perfectly successful
 * filing change nothing at all.
 *
 * ⚠️ THE RESPONSE NEVER SAYS WHETHER THE GATE MOVED. Same reason as the filing
 * route: a `lifts` flag would turn this endpoint into a catalogue oracle. Retry
 * the change and find out — which is the loop being demonstrated.
 */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const result = store.approveException(id);

  if (!result.ok) {
    if (result.error === "ALREADY_APPROVED") {
      return jsonError(
        "ALREADY_APPROVED",
        "That fare exception has already been approved.",
        409,
      );
    }
    return jsonError("NOT_FOUND", "No such fare exception.", 404);
  }

  const booking = store
    .bookings()
    .find((b) => b.id === result.exception.bookingId);

  return Response.json({
    exception: result.exception,
    booking: booking ? store.toDto(booking) : null,
  });
};
