import * as recon from "@/skins/ledgerline/data/recon-store";
import { errorResponse, readJson } from "@/skins/ledgerline/data/http";

type Ctx = { params: Promise<{ sessionId: string }> };

/** Pair one transaction with its receipts: `{ transactionId, receiptIds, adjustment?, note? }`. */
export const POST = async (req: Request, { params }: Ctx) => {
  try {
    return Response.json(
      recon.putPair((await params).sessionId, await readJson(req)),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(
      error,
      "POST reconciliation/sessions/[sessionId]/pairs",
    );
  }
};
