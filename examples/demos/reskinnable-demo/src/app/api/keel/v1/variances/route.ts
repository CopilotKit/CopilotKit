import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";

/**
 * BEAT 6 — file a DRAFT publication variance. Half of the unlock path.
 *
 * ⚠️ THE 422 MUST NOT ENUMERATE THE CATALOGUE. An uncatalogued code is refused
 * with the code the caller sent and nothing else. This is the one place in the
 * app where the rule "enumerate every closed set so the vocabulary reaches the
 * model" is INVERTED: for beat 6's gate, the vocabulary reaching the model IS
 * the defect. An agent that can read the valid values out of a refusal can brute
 * force the gate, never has to be taught anything, and the demo proves nothing
 * while looking perfect. Compare `documents/[docId]/flag`, whose 422 lists its
 * valid reasons deliberately — that vocabulary is beat 5's and is meant to be
 * known.
 *
 * `filedBy` / `role` are DERIVED from the resolved persona; the register has to
 * record who actually filed it.
 */
export const GET = async () => Response.json(store.variances());

export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "BAD_REQUEST", message: "A JSON body is required." },
      { status: 400 },
    );
  }
  const { docId, code, rationale, personaId } = body as {
    docId?: string;
    code?: string;
    rationale?: string;
    personaId?: string;
  };
  const persona = personaId ? findPersona(personaId) : undefined;
  if (!persona) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known personaId is required." },
      { status: 400 },
    );
  }

  try {
    const variance = store.fileVariance(
      docId ?? "",
      code ?? "",
      rationale ?? "",
      persona,
    );
    return Response.json(variance, { status: 201 });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "UNKNOWN";
    if (reason === "NOT_FOUND") {
      return Response.json(
        { error: reason, message: "That document is not in the register." },
        { status: 404 },
      );
    }
    if (reason === "NO_PENDING_REVISION") {
      return Response.json(
        {
          error: reason,
          message: "That document has no revision awaiting release.",
        },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error: "UNKNOWN_VARIANCE_CODE",
        // The code the caller sent, echoed so they can see what was read — and
        // NOTHING about what would have been accepted.
        message: `"${code}" is not a recognized publication-variance code.`,
      },
      { status: 422 },
    );
  }
};
