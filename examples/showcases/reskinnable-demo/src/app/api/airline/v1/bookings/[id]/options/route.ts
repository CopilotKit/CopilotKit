import * as store from "@/skins/airline/data/store";
import { resolveBookingOr404 } from "@/skins/airline/data/route-helpers";
import { readLevers } from "@/skins/airline/data/rebooking-levers";
import {
  applyLevers,
  optionsForBooking,
} from "@/skins/airline/data/rebooking-options";

/**
 * BEAT 3c — the rebooking search, server-side.
 *
 * The PAGE filters the ledger snapshot it already has; this route exists so the
 * same question can be asked over REST (by a tool, or by the proof script) and
 * get the same answer. It reads the levers with the SAME `readLevers` the page
 * does and runs the SAME `applyLevers` pipeline, so the two cannot drift into
 * two different opinions about what "evening nonstops" means.
 *
 * BOTH lengths are published. `matching` is the count with the levers applied,
 * before `top` truncates; `visible` is what a "Top 5 of 18" caption should print
 * as its numerator. Commerce shipped a caption whose denominator came from the
 * unfiltered collection, so the one number the room is asked to read as proof of
 * the maneuver instead said the filters did nothing.
 */
export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const found = resolveBookingOr404(id);
  if (!found.ok) return found.response;

  const levers = readLevers(new URL(req.url).searchParams);
  const all = optionsForBooking(store.options(), found.booking.id);
  const { matching, visible } = applyLevers(all, levers);

  return Response.json({
    bookingId: found.booking.id,
    levers,
    total: all.length,
    matchingCount: matching.length,
    visibleCount: visible.length,
    options: visible,
  });
};
