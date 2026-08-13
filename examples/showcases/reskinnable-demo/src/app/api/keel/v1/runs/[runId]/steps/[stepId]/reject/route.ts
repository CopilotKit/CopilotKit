import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";

/**
 * Reject one approval gate on a run, which cancels the run.
 *
 * Same role check as the approve route — it is the same `findGate` in the same
 * pure engine — so the pair cannot drift into disagreeing about who may act.
 * A rejection records `rejectedBy` on the step and NEVER `approvedBy`: the two
 * fields are separate on `RunStep` precisely so a rejected gate can never be
 * read as an approval by a later consumer that only checks for a name.
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
  const result = store.rejectStep(runId, stepId, persona.id, note);
  if (!result.ok) {
    return Response.json(
      { error: "STEP_NOT_ACTIONABLE", message: result.reason },
      { status: 409 },
    );
  }
  return Response.json(result.run);
};
