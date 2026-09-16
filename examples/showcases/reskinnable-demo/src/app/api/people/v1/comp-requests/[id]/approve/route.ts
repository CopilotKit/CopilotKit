import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/**
 * BEAT 6 — THE GATE.
 *
 * Approving a comp request writes the requested salary and level onto the
 * employee. When the requested figure sits outside the band for the proposed
 * level and no APPROVED, JUSTIFYING band exception is on file, `store` throws
 * `OUT_OF_BAND` and this returns 422.
 *
 * The refusal is SYMPTOM-ONLY — see the note on `OUT_OF_BAND` in
 * `src/skins/people/data/http.ts`. It says the band was exceeded; it never says
 * anything about band exceptions, which codes justify, or that a path around
 * the gate exists at all. That silence is what forces the agent to stop and ask
 * to be shown, which is the beat.
 *
 * The gate is LIFTABLE, and both ways matter for the demo:
 *   - `cmp-rhea` is in band, so this returns 201 with no exception at all —
 *     proving the endpoint works and the 422 is a policy, not a bug.
 *   - `cmp-marcus` / `cmp-naomi` are out of band, so they need the unlock.
 */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const { request, employee } = store.approveCompRequest(id);
    return Response.json({ request, employee }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST comp-requests/[id]/approve");
  }
};
