import * as store from "@/skins/ledgerline/data/store";
import { errorResponse } from "@/skins/ledgerline/data/http";

export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    return Response.json(store.reimburseReport((await params).id));
  } catch (error) {
    return errorResponse(error, "POST reports/[id]/reimburse");
  }
};
