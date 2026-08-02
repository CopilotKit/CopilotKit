import * as store from "@/skins/logistics/data/store";

export const GET = async () => Response.json(store.decisions());

export const POST = async (req: Request) => {
  const body = await req.json();
  const { shipmentId, kind, costUsd, rationale, decidedBy, role, status } =
    body;
  if (!shipmentId || !kind || !rationale) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: "shipmentId, kind and rationale are required.",
      },
      { status: 400 },
    );
  }
  const filed = store.addDecision({
    shipmentId,
    kind,
    costUsd: Number(costUsd) || 0,
    rationale,
    decidedBy: decidedBy ?? "Unknown",
    role: role ?? "Planner",
    status: status === "escalated" ? "escalated" : "committed",
  });
  return Response.json(filed, { status: 201 });
};
