import * as store from "@/skins/airline/data/store";
import {
  jsonError,
  readJsonObject,
  resolveBookingOr404,
} from "@/skins/airline/data/route-helpers";

/**
 * BEAT 6, unlock step 1 — file a fare exception against a booking.
 *
 * ⚠️ NEITHER THE REFUSAL NOR THE RECEIPT NAMES THE CATALOGUE. A 4xx body is one
 * of the five channels that leak a gate's vocabulary (failure-modes § 10), and
 * it is the easiest one to leak through by accident: "valid codes are X, Y, Z"
 * is the reflex every other route in this app follows. Here it is the defect. An
 * uncatalogued code comes back `INVALID_EXCEPTION_CODE` with a sentence that
 * names nothing, so guessing stays expensive.
 *
 * ⚠️ AND THE 201 NEVER SAYS WHETHER THE EXCEPTION WILL LIFT ANYTHING. A `lifts`
 * flag would hand over the whole catalogue one probe at a time — file, read the
 * flag, discard, repeat. The only way to find out is to retry the change, which
 * is exactly the loop the passenger demonstrates on stage. `route.test.ts`
 * asserts the absence.
 *
 * `MISSING_DOCUMENTATION` is safe to state plainly: it is about the passenger's
 * own paperwork, not about which category works. An exception with nothing
 * behind it is not a filing.
 */
export const POST = async (req: Request) => {
  const body = await readJsonObject(req);
  if (!body) return jsonError("BAD_REQUEST", "A JSON body is required.", 400);

  const ref = typeof body.booking === "string" ? body.booking : "";
  const found = resolveBookingOr404(ref);
  if (!found.ok) return found.response;

  const code = typeof body.code === "string" ? body.code : "";
  const documentReference =
    typeof body.documentReference === "string" ? body.documentReference : "";
  const rationale = typeof body.rationale === "string" ? body.rationale : "";

  const result = store.fileException(
    found.booking,
    code,
    documentReference,
    rationale,
  );

  if (!result.ok) {
    if (result.error === "MISSING_DOCUMENTATION") {
      return jsonError(
        "MISSING_DOCUMENTATION",
        "A fare exception has to cite the documentation behind it.",
        422,
      );
    }
    return jsonError(
      "INVALID_EXCEPTION_CODE",
      "That is not a recognised fare exception category.",
      422,
    );
  }

  return Response.json({ exception: result.exception }, { status: 201 });
};
