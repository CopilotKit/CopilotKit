import type { NextRequest } from "next/server";
import * as store from "@/skins/commerce/data/store";
import { errorResponse, readJsonBody } from "@/skins/commerce/data/http";

/**
 * BEAT 5, step 3 — the note. The 🚨 prefix is forced by the tool, not here.
 *
 * `text` and `author` are length-bounded by the store (`NOTE_TOO_LONG` /
 * `ACTOR_NAME_TOO_LONG`, both mapped to 400 in `data/http.ts`) for the same
 * reason the notify route validates its template: the note is rendered on the
 * Orders page and its text is handed to the beat-3b readable as `latestNote`,
 * so an unbounded body is a channel into the next prompt.
 *
 * The body is decoded by `readJsonBody` BEFORE the `try` opens — an unreadable
 * one is a deliberate 400 naming the order, not a `SyntaxError` indistinguishable
 * from a store defect.
 */
export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const parsed = await readJsonBody(req, "POST orders/[id]/notes", id);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  try {
    const text = String(body.text ?? "").trim();
    if (!text) {
      return Response.json(
        { error: "BAD_REQUEST", message: "A note needs some text." },
        { status: 400 },
      );
    }
    const updated = store.addOrderNote(
      id,
      text,
      String(body.author ?? "").trim() || "Bellwether",
    );
    return Response.json(updated, { status: 201 });
  } catch (error) {
    return errorResponse(error, `POST orders/[id]/notes id=${id}`);
  }
};
