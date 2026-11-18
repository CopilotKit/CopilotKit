import * as store from "@/skins/ledgerline/data/store";
import { errorResponse } from "@/skins/ledgerline/data/http";

/** The gate: 409 POLICY_HOLD while a hold is open. Names the code, never the fix. */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    return Response.json(store.approveReport((await params).id));
  } catch (error) {
    return errorResponse(error, "POST reports/[id]/approve");
  }
};
