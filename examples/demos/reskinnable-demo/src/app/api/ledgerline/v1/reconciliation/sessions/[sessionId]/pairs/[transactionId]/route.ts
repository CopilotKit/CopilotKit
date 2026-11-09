import * as recon from "@/skins/ledgerline/data/recon-store";
import { errorResponse } from "@/skins/ledgerline/data/http";

type Ctx = { params: Promise<{ sessionId: string; transactionId: string }> };

export const DELETE = async (_req: Request, { params }: Ctx) => {
  try {
    const { sessionId, transactionId } = await params;
    return Response.json(recon.deletePair(sessionId, transactionId));
  } catch (error) {
    return errorResponse(
      error,
      "DELETE reconciliation/sessions/[sessionId]/pairs/[transactionId]",
    );
  }
};
