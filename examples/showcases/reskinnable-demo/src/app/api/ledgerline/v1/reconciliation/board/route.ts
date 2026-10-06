import * as recon from "@/skins/ledgerline/data/recon-store";
import { errorResponse } from "@/skins/ledgerline/data/http";

export const dynamic = "force-dynamic";

/** The Reconcile board's view: cards, or one card's transactions, receipts and open session. */
export const GET = (req: Request) => {
  try {
    const cardId = new URL(req.url).searchParams.get("card");
    return Response.json(
      cardId ? recon.board(cardId) : { cards: recon.cards() },
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error, "GET reconciliation/board");
  }
};
