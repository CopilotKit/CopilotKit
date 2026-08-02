import * as store from "@/skins/logistics/data/store";

export const GET = async () => Response.json(store.decisions());

export const POST = async (req: Request) => {
  const body = await req.json();
  // decidedBy/role are NEVER read from the body — they are derived from the
  // resolved planner server-side. A client that could set them (or an arbitrary
  // costUsd that walked through a gate) would be forging the audit trail.
  const { shipmentId, kind, costUsd, rationale, plannerId, status } = body;
  if (!shipmentId || !kind || !rationale) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: "shipmentId, kind and rationale are required.",
      },
      { status: 400 },
    );
  }
  if (!plannerId) {
    return Response.json(
      { error: "BAD_REQUEST", message: "plannerId is required." },
      { status: 400 },
    );
  }
  const planner = store.findPlanner(plannerId);
  if (!planner) {
    return Response.json(
      { error: "BAD_REQUEST", message: "Unknown planner." },
      { status: 400 },
    );
  }
  if (!store.findShipment(shipmentId)) {
    return Response.json(
      { error: "NOT_FOUND", message: "Shipment not found." },
      { status: 404 },
    );
  }
  const filed = store.addDecision({
    shipmentId,
    kind,
    costUsd: Number(costUsd) || 0,
    rationale,
    decidedBy: planner.name,
    role: planner.role,
    status: status === "escalated" ? "escalated" : "committed",
  });
  return Response.json(filed, { status: 201 });
};
