import * as store from "@/skins/ledgerline/data/store";
import { errorResponse } from "@/skins/ledgerline/data/http";

export const dynamic = "force-dynamic";
export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    return Response.json(store.getReport((await params).id));
  } catch (error) {
    return errorResponse(error, "GET reports/[id]");
  }
};
