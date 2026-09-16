import { z } from "zod";
import * as store from "@/skins/exec/data/store";
import { storeErrorResponse } from "@/skins/exec/data/store-errors";

const DashboardIdParam = z.enum(["ceo", "cfo"]);

const AddBlockBody = z.object({
  blockId: z.string(),
});

/**
 * Moves a draft block onto a dashboard. `dashboardId` is validated BEFORE the
 * store is touched, and the store now guards the same argument again:
 * `addBlockToDashboard` goes through `requireDashboard`, which throws
 * `NOT_FOUND: no dashboard "<id>"` and reaches the client as a coded 404
 * through `storeErrorResponse`'s table. So an unvalidated id is no longer a
 * TypeError off `undefined.blocks`, and this zod enum is not what stops a
 * crash — it is what answers 400 with the ALLOWED VALUES named, which the
 * store's 404 cannot say, and it keeps the refusal here rather than
 * discovering it one layer down. Idempotent by construction (see
 * `store.addBlockToDashboard`'s doc comment) — no second guard needed here.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ dashboardId: string }> },
) => {
  const { dashboardId } = await params;
  const parsedDashboardId = DashboardIdParam.safeParse(dashboardId);
  if (!parsedDashboardId.success) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: `Invalid dashboardId. Expected one of: ${DashboardIdParam.options.join(", ")}.`,
        issues: parsedDashboardId.error.issues,
      },
      { status: 400 },
    );
  }

  const raw = await req.json().catch(() => null);
  const parsedBody = AddBlockBody.safeParse(raw);
  if (!parsedBody.success) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: "Invalid request body. Expected { blockId: string }.",
        issues: parsedBody.error.issues,
      },
      { status: 400 },
    );
  }

  // `addBlockToDashboard` signals its two refusals by throwing (see its doc
  // comment); `storeErrorResponse` is the one table that maps them —
  // `NOT_FOUND` → 404 for an id with no draft behind it (the shape a
  // hallucinated `blockId` from `pinBlockToDashboard` takes), `ALREADY_PINNED`
  // → 409 for a block the OTHER dashboard holds. Unhandled either is a 500
  // with a stack trace, which reaches the agent as an opaque failure it
  // retries identically; the coded response carries the message that says
  // which id, which dashboard, and therefore what to do instead.
  try {
    const block = store.addBlockToDashboard(
      parsedDashboardId.data,
      parsedBody.data.blockId,
    );
    return Response.json(block, { status: 200 });
  } catch (error) {
    const res = storeErrorResponse(error);
    if (res) return res;
    throw error;
  }
};
