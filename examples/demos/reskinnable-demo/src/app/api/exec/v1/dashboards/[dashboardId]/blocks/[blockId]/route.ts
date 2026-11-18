import { z } from "zod";
import * as store from "@/skins/exec/data/store";
import { storeErrorResponse } from "@/skins/exec/data/store-errors";

const DashboardIdParam = z.enum(["ceo", "cfo"]);

const MoveBlockBody = z.object({
  direction: z.enum(["up", "down"]),
});

/**
 * Unpins a block. `store.removeBlock` THROWS `NOT_FOUND` for a blockId that
 * is not on this dashboard (including one pinned to the other), so a failed
 * unpin answers 404 with the id in the message rather than 200 with the
 * untouched block list — which is what it used to do, making a failed unpin
 * indistinguishable from a successful one to both the grid and the agent, and
 * inconsistent with the POST on this same resource.
 *
 * A successful DELETE returns the block to `drafts`, so the pin control still
 * on screen in the chat can re-pin it (see `store.removeBlock`'s comment).
 */
export const DELETE = async (
  _req: Request,
  { params }: { params: Promise<{ dashboardId: string; blockId: string }> },
) => {
  const { dashboardId, blockId } = await params;
  const parsedDashboardId = DashboardIdParam.safeParse(dashboardId);
  if (!parsedDashboardId.success) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: `Invalid dashboardId "${dashboardId}".`,
        issues: parsedDashboardId.error.issues,
      },
      { status: 400 },
    );
  }
  try {
    store.removeBlock(parsedDashboardId.data, blockId);
  } catch (error) {
    const res = storeErrorResponse(error);
    if (res) return res;
    throw error;
  }
  return Response.json(
    store.snapshot().dashboards[parsedDashboardId.data].blocks,
  );
};

/**
 * Reorders a block by one position. 404s an unknown blockId for the same
 * reason DELETE does. A move that would fall off either end is NOT an error —
 * see `store.moveBlock` — so it answers 200 with the unchanged list.
 */
export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ dashboardId: string; blockId: string }> },
) => {
  const { dashboardId, blockId } = await params;
  const parsedDashboardId = DashboardIdParam.safeParse(dashboardId);
  if (!parsedDashboardId.success) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: `Invalid dashboardId "${dashboardId}".`,
        issues: parsedDashboardId.error.issues,
      },
      { status: 400 },
    );
  }
  const raw = await req.json().catch(() => null);
  const parsedBody = MoveBlockBody.safeParse(raw);
  if (!parsedBody.success) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: "Invalid move-block payload.",
        issues: parsedBody.error.issues,
      },
      { status: 400 },
    );
  }
  try {
    store.moveBlock(parsedDashboardId.data, blockId, parsedBody.data.direction);
  } catch (error) {
    const res = storeErrorResponse(error);
    if (res) return res;
    throw error;
  }
  return Response.json(
    store.snapshot().dashboards[parsedDashboardId.data].blocks,
  );
};
