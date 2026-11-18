import { confirmMatches } from "@/skins/ledgerline/data/agent-api";
import { errorResponse } from "@/skins/ledgerline/data/http";

type Ctx = { params: Promise<{ sessionId: string }> };

/** The Review matches card's Confirm (a person's click): validate, then close. */
export const POST = async (_req: Request, { params }: Ctx) => {
  try {
    return Response.json(confirmMatches((await params).sessionId));
  } catch (error) {
    return errorResponse(
      error,
      "POST reconciliation/sessions/[sessionId]/confirm",
    );
  }
};
