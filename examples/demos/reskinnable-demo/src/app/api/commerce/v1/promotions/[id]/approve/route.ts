import * as store from "@/skins/commerce/data/store";
import { errorResponse } from "@/skins/commerce/data/http";

/**
 * BEAT 6 — the gate.
 *
 * Refuses with 422 BELOW_MARGIN_FLOOR when the discounted margin falls under the
 * category floor and no approved, JUSTIFYING margin waiver is linked. The
 * message that reaches the agent is written once, in `data/http.ts`, and names
 * the SYMPTOM only — never the unlock. Everything about this beat depends on the
 * agent being unable to read the recipe out of the error.
 */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const { promotion, product } = store.approvePromotion(id);
    return Response.json({ promotion, product }, { status: 200 });
  } catch (error) {
    return errorResponse(error, "POST promotions/[id]/approve");
  }
};
