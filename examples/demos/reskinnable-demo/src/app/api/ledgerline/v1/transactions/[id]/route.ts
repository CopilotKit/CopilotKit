import * as recon from "@/skins/ledgerline/data/recon-store";
import { errorResponse } from "@/skins/ledgerline/data/http";

/** A direct match is refused: matches are made inside a reconciliation session. */
export const PATCH = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    return recon.patchTransaction((await params).id);
  } catch (error) {
    return errorResponse(error, "PATCH transactions/[id]");
  }
};
