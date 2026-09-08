import * as store from "@/skins/logistics/data/store";
import { findOption } from "@/skins/logistics/data/mitigation-options";
import { checkAuthority } from "@/skins/logistics/data/authority";

/**
 * The gated write. Cost is ALWAYS recomputed here from lane + shipment; any
 * `costUsd` in the request body is ignored. Trusting a client figure would let
 * a caller send `{ costUsd: 1 }` and walk straight through the authority gate.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const shipment = store.findShipment(id);
  if (!shipment) {
    return Response.json(
      { error: "NOT_FOUND", message: "Shipment not found." },
      { status: 404 },
    );
  }

  const body = await req.json();
  const { kind, rationale, plannerId } = body;
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

  const option = findOption(shipment, store.lanes(), kind);
  if (!option) {
    return Response.json(
      {
        error: "UNAVAILABLE_OPTION",
        message: `"${kind}" is not an available mitigation for this shipment.`,
      },
      { status: 422 },
    );
  }

  const verdict = checkAuthority({
    costUsd: option.costUsd,
    planner,
    shipment,
    escalations: store.escalations(),
  });
  if (!verdict.allowed) {
    return Response.json(
      { error: verdict.code, message: verdict.message },
      { status: 403 },
    );
  }

  const updated = store.updateShipment(id, {
    appliedMitigation: {
      kind: option.kind,
      costUsd: option.costUsd,
      decidedAt: new Date().toISOString(),
    },
    status: option.slaMet ? "resolved" : "at_risk",
    etaCurrent: option.etaDate,
  });
  store.addDecision({
    shipmentId: id,
    kind: option.kind,
    costUsd: option.costUsd,
    rationale: rationale ?? option.rationale,
    decidedBy: planner.name,
    role: planner.role,
    status: "committed",
  });
  return Response.json({ shipment: updated, option });
};
