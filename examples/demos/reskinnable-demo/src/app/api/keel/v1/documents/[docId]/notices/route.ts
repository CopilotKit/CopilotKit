import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";
import { OWNER_NOTICE_TEMPLATES } from "@/skins/keel/data/handling";

/**
 * BEAT 5, step 2 — send the owning department a templated notice.
 *
 * The department the notice goes to is copied off the RECORD inside the store,
 * never taken from the body: a client-supplied owner is an owner the model
 * spelled, and a notice addressed to a department that does not own the document
 * is a false claim the register would then keep.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ docId: string }> },
) => {
  const { docId } = await params;
  const { template, personaId } = await req.json().catch(() => ({}));
  const persona = personaId ? findPersona(personaId) : undefined;
  if (!persona) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known personaId is required." },
      { status: 400 },
    );
  }
  try {
    const notice = store.sendOwnerNotice(docId, template, persona.name);
    return Response.json(notice, { status: 201 });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN";
    if (code === "NOT_FOUND") {
      return Response.json(
        { error: code, message: "That document is not in the register." },
        { status: 404 },
      );
    }
    // Named on purpose — see the flag route and data/handling.ts.
    return Response.json(
      {
        error: "INVALID_NOTICE",
        message: `"${template}" is not an owner-notice template. Valid templates: ${OWNER_NOTICE_TEMPLATES.join(", ")}.`,
      },
      { status: 422 },
    );
  }
};
