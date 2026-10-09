import * as recon from "@/skins/ledgerline/data/recon-store";
import { errorResponse } from "@/skins/ledgerline/data/http";

type Ctx = { params: Promise<{ sessionId: string }> };

export const POST = async (_req: Request, { params }: Ctx) => {
  try {
    return Response.json(recon.close((await params).sessionId));
  } catch (error) {
    return errorResponse(
      error,
      "POST reconciliation/sessions/[sessionId]/close",
    );
  }
};
