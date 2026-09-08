import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";

/**
 * BEAT 5, step 3 — post a short note on the document record.
 *
 * The 🚨 marker is FORCED by the store, not requested from the caller: the note
 * is this beat's only artifact that reads from the back of a room, and a model
 * that phrased it politely would silently cost the beat its visible change.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ docId: string }> },
) => {
  const { docId } = await params;
  const { text, personaId } = await req.json().catch(() => ({}));
  const persona = personaId ? findPersona(personaId) : undefined;
  if (!persona) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known personaId is required." },
      { status: 400 },
    );
  }
  try {
    const note = store.addDocumentNote(docId, text ?? "", persona.name);
    return Response.json(note, { status: 201 });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN";
    if (code === "NOT_FOUND") {
      return Response.json(
        { error: code, message: "That document is not in the register." },
        { status: 404 },
      );
    }
    return Response.json(
      { error: "EMPTY_NOTE", message: "A note needs some text." },
      { status: 422 },
    );
  }
};
