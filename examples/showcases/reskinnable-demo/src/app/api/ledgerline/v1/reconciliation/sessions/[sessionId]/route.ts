import * as recon from "@/skins/ledgerline/data/recon-store";
import { errorResponse } from "@/skins/ledgerline/data/http";

type Ctx = { params: Promise<{ sessionId: string }> };

export const GET = async (_req: Request, { params }: Ctx) => {
  try {
    return Response.json(recon.getSession((await params).sessionId));
  } catch (error) {
    return errorResponse(error, "GET reconciliation/sessions/[sessionId]");
  }
};
