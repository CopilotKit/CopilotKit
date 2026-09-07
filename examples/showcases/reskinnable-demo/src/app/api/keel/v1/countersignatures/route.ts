import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";
import { checkReleaseAuthority } from "@/skins/keel/data/release-authority";
import { readSigningPin } from "@/skins/keel/data/signing-pin";

/**
 * BEAT 3a — the e-signature countersignature that releases a revision.
 *
 * The operator types their PIN into a card in the chat and this route receives
 * it directly; the agent's `respond()` only ever gets the confirmation sentence
 * the card composes afterwards. The PIN is never echoed back in any response
 * body either — a refusal says "not accepted", never what was typed.
 *
 * ⚠️ THE PIN IS A SECOND FACTOR, NOT A RELEASE AUTHORITY. It confirms WHO is
 * acting; it never changes WHICH revisions may go out. So this route runs the
 * SAME `checkReleaseAuthority()` gate as `POST /documents/:id/release`, on the
 * same record, and a valid PIN on an UNENDORSED revision is still refused with
 * `UNENDORSED_REVISION`. If a PIN could release an unendorsed revision it would
 * become a second unlock path around beat 6's variance gate — the agent would
 * route around the gate, the teach arc would never fire, and NOTHING would fail.
 * The app would compile, the card would be gorgeous, the write would land, and
 * the room would applaud. `route.test.ts` pins that separation; it is the only
 * symptom the failure has.
 *
 * ⚠️ PIN VALIDITY IS FORMAT-ONLY, BY DESIGN. There is no secret to match
 * against: no persona carries a PIN or a digest, so ANY six digits are accepted,
 * for any operator. `readSigningPin` checks the SHAPE and nothing else, and
 * `INVALID_PIN` means "not six digits", never "wrong PIN". Deliberate for a
 * stage demo — the beat's claim is about WHERE the value travels, not about
 * authenticating anyone. Nothing here is an authentication control; the real
 * control on this route is `checkReleaseAuthority()` below. See
 * `data/signing-pin.ts` for the full account.
 *
 * THE CARD PICKS THE RECORD'S OWN PENDING REVISION AND THE AGENT NAMES ONLY THE
 * DOCUMENT. There is deliberately no `revision` parameter: if the caller could
 * choose which revision to release, the agent could choose an unendorsed one and
 * we would be back to asking the PIN to do the gate's job.
 */
export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "BAD_REQUEST", message: "A JSON body is required." },
      { status: 400 },
    );
  }
  const {
    document: ref,
    pin,
    personaId,
  } = body as {
    document?: string;
    pin?: unknown;
    personaId?: string;
  };

  // THE PIN IS CHECKED FIRST, before anything that reads the register. It is
  // only a format check (see the header), but the 404 and 409 below are ANSWERS:
  // they tell an unauthenticated caller which documents exist and which of them
  // have a revision waiting. Refusing an unreadable request before consulting
  // the store means those answers are never handed out for free. The SAME
  // predicate the card's submit button compared against — imported, not
  // restated, so the server cannot drift into accepting a shape the card refuses
  // (or refusing one it invited).
  const verdict = readSigningPin(typeof pin === "string" ? pin : "");
  if (!verdict.ok) {
    return Response.json(
      // Never echo what was typed.
      {
        error: "INVALID_PIN",
        message: "That e-signature PIN was not accepted.",
      },
      { status: 401 },
    );
  }

  const persona = personaId ? findPersona(personaId) : undefined;
  if (!persona) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known personaId is required." },
      { status: 400 },
    );
  }

  // The card sends the human-facing reference (POL-114); accept the docId too.
  const record =
    store.findDocument(ref ?? "") ?? store.findDocumentByRef(ref ?? "");
  if (!record) {
    return Response.json(
      { error: "NOT_FOUND", message: "That document is not in the register." },
      { status: 404 },
    );
  }

  if (!record.pendingRevision) {
    return Response.json(
      {
        error: "NO_PENDING_REVISION",
        message: `${record.ref} has no revision awaiting release.`,
      },
      { status: 409 },
    );
  }

  const authority = checkReleaseAuthority({
    record,
    variances: store.variances(),
  });
  if (!authority.allowed) {
    return Response.json(
      {
        error: authority.code,
        message: authority.message,
        missing: authority.missing,
      },
      { status: 403 },
    );
  }

  const released = store.releaseRevision(
    record.docId,
    persona.name,
    authority.via,
    authority.varianceId,
  );
  return Response.json({ record: released, via: authority.via });
};
