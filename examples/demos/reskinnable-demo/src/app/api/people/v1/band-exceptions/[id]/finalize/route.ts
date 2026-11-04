import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/**
 * BEAT 6, unlock step 2 — finalize a draft exception to `approved` and link it
 * to its comp request.
 *
 * Note that finalizing a DECOY succeeds too. The linkage is real; only
 * `store.hasApprovedJustifyingException` decides whether the gate lifts. Making
 * this step succeed for every valid code is what keeps the discrimination in
 * one place (the catalogue) instead of scattering "is this the right code?"
 * across three endpoints where it could drift.
 */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    return Response.json(store.finalizeBandException(id), { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST band-exceptions/[id]/finalize");
  }
};
