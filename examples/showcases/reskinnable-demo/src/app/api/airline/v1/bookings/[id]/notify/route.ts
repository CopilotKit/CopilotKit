import * as store from "@/skins/airline/data/store";
import {
  jsonError,
  readJsonObject,
  resolveBookingOr404,
} from "@/skins/airline/data/route-helpers";
import {
  NOTICE_TEMPLATES,
  NOTIFY_PARTIES,
} from "@/skins/airline/data/handling";

/**
 * BEAT 5, step 3 — tell somebody downstream that the trip moved.
 *
 * The contact is copied off the BOOKING, never taken from the caller: a
 * client-supplied name is a name the model spelled, and this record is the app
 * claiming it told a specific person. A party the booking has no contact for is
 * REFUSED with `NO_CONTACT_ON_FILE`, so Aeronova never claims to have reached
 * someone it has no way of reaching.
 *
 * The trip-log entry carries a FORCED 🚨 marker (applied in the store, not
 * requested here) so the change is un-skimmable on a projector.
 *
 * ⚠️ Both vocabularies are GIVEN to the agent and are enumerated in the
 * refusals below on purpose — see the note in the seat route.
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

  const party = typeof body.party === "string" ? body.party : "";
  const template = typeof body.template === "string" ? body.template : "";
  const result = store.notifyParty(found.booking, party, template);

  if (!result.ok) {
    switch (result.error) {
      case "INVALID_PARTY":
        return jsonError(
          "INVALID_PARTY",
          `Parties are: ${NOTIFY_PARTIES.join(", ")}.`,
          422,
        );
      case "INVALID_TEMPLATE":
        return jsonError(
          "INVALID_TEMPLATE",
          `Messages are: ${NOTICE_TEMPLATES.join(", ")}.`,
          422,
        );
      case "NO_CONTACT_ON_FILE":
        return jsonError(
          "NO_CONTACT_ON_FILE",
          `${found.booking.reference} has no ${party} contact on file, so ` +
            `nobody was told.`,
          422,
        );
    }
  }

  return Response.json(
    { booking: store.toDto(found.booking), notice: result.notice },
    { status: 201 },
  );
};
