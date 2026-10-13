import { reviewView } from "@/skins/ledgerline/data/agent-api";
import { errorResponse } from "@/skins/ledgerline/data/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ sessionId: string }> };

/** What the Review matches card shows: each charge with its receipts and adjustment. */
export const GET = async (_req: Request, { params }: Ctx) => {
  try {
    return Response.json(reviewView((await params).sessionId));
  } catch (error) {
    return errorResponse(
      error,
      "GET reconciliation/sessions/[sessionId]/review",
    );
  }
};
