import * as store from "@/skins/ledgerline/data/store";
import { errorResponse, readJson } from "@/skins/ledgerline/data/http";

export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { costCenterId } = await readJson(req);
    return Response.json(
      store.allocateCostCenter((await params).id, String(costCenterId ?? "")),
    );
  } catch (error) {
    return errorResponse(error, "POST reports/[id]/allocate");
  }
};
