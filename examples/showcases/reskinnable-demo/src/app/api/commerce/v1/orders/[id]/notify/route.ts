import type { NextRequest } from "next/server";
import * as store from "@/skins/commerce/data/store";
import { errorResponse, readJsonBody } from "@/skins/commerce/data/http";

/**
 * BEAT 5, step 2 — notify the customer.
 *
 * This writes a real, listed record rather than pretending to send an email.
 * The Orders page renders the notification log, so the audience sees the second
 * step of the stored procedure land on screen the same way the hold and the note
 * do. A step whose only evidence is a sentence in the transcript is a step the
 * room has to take on trust.
 *
 * Both fields are validated by the store rather than waved through as "a
 * non-empty string": `template` is a closed set of four, and `sentBy` is
 * length-bounded. What is stored here is rendered on the Orders page AND fed to
 * the beat-3b on-screen readable, so an unvalidated body would put arbitrary
 * text in front of the model wearing app state's clothes. `UNKNOWN_TEMPLATE` /
 * `ACTOR_NAME_TOO_LONG` are mapped to 400 in `data/http.ts`.
 *
 * The body is decoded by `readJsonBody` BEFORE the `try` opens, so an unreadable
 * one is a deliberate 400 naming the order rather than a `SyntaxError` that
 * `errorResponse` cannot tell apart from a store defect.
 */
export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const parsed = await readJsonBody(req, "POST orders/[id]/notify", id);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  try {
    const notification = store.notifyCustomer(
      id,
      String(body.template ?? "").trim(),
      String(body.sentBy ?? "").trim() || "Bellwether",
    );
    return Response.json(notification, { status: 201 });
  } catch (error) {
    return errorResponse(error, `POST orders/[id]/notify id=${id}`);
  }
};
