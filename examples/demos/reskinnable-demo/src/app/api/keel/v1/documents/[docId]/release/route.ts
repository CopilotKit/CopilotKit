import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";
import { checkReleaseAuthority } from "@/skins/keel/data/release-authority";

/**
 * BEAT 6 — THE GATED WRITE. Release a pending revision to the workforce.
 *
 * The refusal is `403 UNENDORSED_REVISION` and it names ONLY the symptom: the
 * document, the revision, and which body has not endorsed it. It says nothing
 * about publication variances, nothing about codes, and does not hint that a way
 * through exists. An operator who knows the procedure reads it and knows what to
 * file; an agent that does not, does not — and that asymmetry is the entire
 * beat. A body that enumerated the unlock catalogue would be the fifth leak
 * channel (`.claude/skills/reskin/failure-modes.md` § 10) and would leave
 * nothing to teach.
 *
 * `missing` rides in the body because it is the same fact the register row
 * already prints on screen — the symptom, published once so the refusal and the
 * row cannot disagree about who has not signed.
 *
 * `releasedBy` is DERIVED from the resolved persona and never read off the body:
 * a client that could set it would be forging the signature the register keeps.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ docId: string }> },
) => {
  const { docId } = await params;
  const record = store.findDocument(docId);
  if (!record) {
    return Response.json(
      { error: "NOT_FOUND", message: "That document is not in the register." },
      { status: 404 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "BAD_REQUEST", message: "A JSON body is required." },
      { status: 400 },
    );
  }
  const { personaId } = body as { personaId?: string };
  const persona = personaId ? findPersona(personaId) : undefined;
  if (!persona) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known personaId is required." },
      { status: 400 },
    );
  }

  if (!record.pendingRevision) {
    // 409, not 403: nothing is being refused. Answering with the gate's own code
    // would teach an operator to file a variance against a revision that does
    // not exist.
    return Response.json(
      {
        error: "NO_PENDING_REVISION",
        message: `${record.ref} has no revision awaiting release.`,
      },
      { status: 409 },
    );
  }

  const verdict = checkReleaseAuthority({
    record,
    variances: store.variances(),
  });
  if (!verdict.allowed) {
    return Response.json(
      {
        error: verdict.code,
        message: verdict.message,
        missing: verdict.missing,
      },
      { status: 403 },
    );
  }

  const released = store.releaseRevision(
    docId,
    persona.name,
    verdict.via,
    verdict.varianceId,
  );
  return Response.json({ record: released, via: verdict.via });
};
