import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";

/**
 * Approve one approval gate on a run.
 *
 * The ROLE CHECK lives in the pure engine (`data/engine.ts`, `findGate`) and is
 * therefore identical here and in `useKeelData` — a gate names an `approverRole`
 * and only a persona holding that role may clear it. Duplicating that rule in
 * this route is how the server and the client would end up disagreeing about who
 * may approve what, which is the one disagreement a run engine cannot survive.
 *
 * ⚠️ THIS IS NOT BEAT 6's GATE, and the two must not be conflated by a later
 * slot. A run gate refuses because you are the WRONG PERSON (`403`, and
 * switching persona clears it); beat 6's release gate refuses because the
 * REVISION is not endorsed, and no persona in this app can clear that without
 * the variance the agent has to be taught. A prompt that describes them with the
 * same words is how the agent learns to try the wrong one.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ runId: string; stepId: string }> },
) => {
  const { runId, stepId } = await params;
  const { personaId, note } = await req.json().catch(() => ({}));
  const persona = personaId ? findPersona(personaId) : undefined;
  if (!persona) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known personaId is required." },
      { status: 400 },
    );
  }
  const result = store.approveStep(runId, stepId, persona.id, note);
  if (!result.ok) {
    // The engine's `reason` is the whole answer and is written to be relayed
    // verbatim — it distinguishes "not found", "already advanced" and "wrong
    // role", and flattening those into one status would cost the agent the only
    // information that tells it whether to retry, switch persona, or stop.
    return Response.json(
      { error: "STEP_NOT_ACTIONABLE", message: result.reason },
      { status: 409 },
    );
  }
  return Response.json(result.run);
};
