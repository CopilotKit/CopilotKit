import * as recon from "@/skins/ledgerline/data/recon-store";
import { errorResponse, readJson } from "@/skins/ledgerline/data/http";

/** Open (or reuse) a reconciliation session: `{ period, cardId }` -> the session. */
export const POST = async (req: Request) => {
  try {
    return Response.json(recon.createSession(await readJson(req)), {
      status: 201,
    });
  } catch (error) {
    return errorResponse(error, "POST reconciliation/sessions");
  }
};
