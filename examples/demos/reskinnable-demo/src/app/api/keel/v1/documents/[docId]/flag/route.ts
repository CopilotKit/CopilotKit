import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";
import { REVIEW_FLAG_REASONS } from "@/skins/keel/data/handling";

/**
 * BEAT 5, step 1 — raise the desk's review flag on a document.
 *
 * `raisedBy` is DERIVED from the resolved persona, never read off the body —
 * same rule as every other write here. A client that could set it would be
 * forging who flagged the document.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ docId: string }> },
) => {
  const { docId } = await params;
  const { reason, personaId } = await req.json().catch(() => ({}));
  const persona = personaId ? findPersona(personaId) : undefined;
  if (!persona) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known personaId is required." },
      { status: 400 },
    );
  }
  try {
    const record = store.raiseReviewFlag(docId, reason, persona.name);
    return Response.json(record, { status: 201 });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN";
    if (code === "NOT_FOUND") {
      return Response.json(
        { error: code, message: "That document is not in the register." },
        { status: 404 },
      );
    }
    // The valid set IS named here, unlike a variance refusal. This vocabulary is
    // GIVEN to the agent on purpose (see data/handling.ts) — beat 5's claim is
    // that it already knows the procedure, so there is nothing to protect and
    // withholding the values would only cost a round trip.
    return Response.json(
      {
        error: "INVALID_REVIEW_REASON",
        message: `"${reason}" is not a review-flag reason. Valid reasons: ${REVIEW_FLAG_REASONS.join(", ")}.`,
      },
      { status: 422 },
    );
  }
};
