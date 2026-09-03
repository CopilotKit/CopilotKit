import { z } from "zod";
import * as store from "@/skins/exec/data/store";

const DashboardIdParam = z.enum(["ceo", "cfo"]);

const AddBlockBody = z.object({
  blockId: z.string(),
});

/**
 * Moves a draft block onto a dashboard. Validation happens BEFORE touching
 * the store: `state.dashboards[dashboardId]` is a plain object index, so an
 * unvalidated `dashboardId` would not 404/400 — it would throw reading
 * `.blocks` off `undefined`. Idempotent by construction (see
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

  const block = store.addBlockToDashboard(
    parsedDashboardId.data,
    parsedBody.data.blockId,
  );
  return Response.json(block, { status: 200 });
};
