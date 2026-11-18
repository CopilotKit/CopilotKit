import * as recon from "@/skins/ledgerline/data/recon-store";
import { errorResponse } from "@/skins/ledgerline/data/http";

export const dynamic = "force-dynamic";

/**
 * One card's close at a glance (the agent's status card): `?card=card_4417`
 * (or the last four); `&origin=api` for what the agent has cleared,
 * `board` for what a person has, `all` (the default) for both.
 */
export const GET = (req: Request) => {
  try {
    const q = new URL(req.url).searchParams;
    const raw = q.get("card") ?? "";
    const cardId = /^\d{4}$/.test(raw) ? `card_${raw}` : raw;
    const o = q.get("origin");
    const origin = o === "board" || o === "api" ? o : "all";
    return Response.json(recon.closeStatus(cardId, origin), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "GET reconciliation/status");
  }
};
