import { z } from "zod";
import * as store from "@/skins/exec/data/store";

const DashboardIdParam = z.enum(["ceo", "cfo"]);

const MoveBlockBody = z.object({
  direction: z.enum(["up", "down"]),
});

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
  store.removeBlock(parsedDashboardId.data, blockId);
  return Response.json(
    store.snapshot().dashboards[parsedDashboardId.data].blocks,
  );
};

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
  store.moveBlock(parsedDashboardId.data, blockId, parsedBody.data.direction);
  return Response.json(
    store.snapshot().dashboards[parsedDashboardId.data].blocks,
  );
};
