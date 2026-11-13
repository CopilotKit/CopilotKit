import * as store from "@/skins/ledgerline/data/store";
import type { LineCoding } from "@/skins/ledgerline/data/store";
import { errorResponse, readJson } from "@/skins/ledgerline/data/http";

/**
 * Recode report lines: `{ lines: [{ lineId, costCenterId }] }`. Answers the
 * report plus the policy engine's re-check, whose `reason` the report page
 * shows when a recode does not clear the hold.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { lines } = await readJson(req);
    return Response.json(
      store.recodeLines(
        (await params).id,
        (Array.isArray(lines) ? lines : []) as LineCoding[],
      ),
    );
  } catch (error) {
    return errorResponse(error, "POST reports/[id]/recode");
  }
};
