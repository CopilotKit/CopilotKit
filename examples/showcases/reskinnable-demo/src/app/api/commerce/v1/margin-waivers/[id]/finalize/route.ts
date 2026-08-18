import * as store from "@/skins/commerce/data/store";
import { errorResponse } from "@/skins/commerce/data/http";

/** BEAT 6, unlock step 2 — finalize a draft waiver so it takes effect. */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    return Response.json(store.finalizeMarginWaiver(id), { status: 200 });
  } catch (error) {
    return errorResponse(error, "POST margin-waivers/[id]/finalize");
  }
};
