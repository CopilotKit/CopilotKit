import type { NextRequest } from "next/server";
import * as store from "@/skins/commerce/data/store";
import {
  errorResponse,
  readJsonBody,
  requireAmount,
} from "@/skins/commerce/data/http";

/**
 * BEAT 3a — a goodwill refund.
 *
 * The figure arrives here from the chat card the MERCHANT typed it into, over a
 * plain fetch from the browser. It was never a tool argument the model authored
 * and it is never written back into the transcript: the HITL tool's `respond()`
 * returns only a label ("Refund issued on Marguerite Bell's return"). The
 * response body below is read by the CLIENT to refresh the returns desk, not by
 * the agent.
 *
 * The "cannot exceed what was charged" check lives in the store rather than
 * here, so the same rule applies however the refund is issued — including from
 * the Returns page's own control. What DOES belong here is the type of the
 * figure: this is the only place an untrusted body is decoded, so `requireAmount`
 * refuses a non-number outright instead of letting `Number()` coerce one into a
 * refund. It is the single route in the skin that moves money, and settling is
 * irreversible — see the note on `requireAmount`.
 *
 * `readJsonBody` runs BEFORE the `try` for the matching reason: a body we could
 * not read is a bad request about a named return (a deliberate 400), while
 * anything the store raises past that point is ours and keeps its logged 500.
 * On the route that moves money the two must never share one report.
 */
export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const parsed = await readJsonBody(req, "POST returns/[id]/refund", id);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  try {
    const updated = store.issueRefund(id, requireAmount(body.amount));
    return Response.json(updated, { status: 200 });
  } catch (error) {
    return errorResponse(error, `POST returns/[id]/refund id=${id}`);
  }
};
