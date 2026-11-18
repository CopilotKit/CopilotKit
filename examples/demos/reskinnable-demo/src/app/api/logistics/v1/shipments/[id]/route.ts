import * as store from "@/skins/logistics/data/store";
import type { Shipment } from "@/skins/logistics/data/types";

export const GET = async (
  _req: Request,
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
  return Response.json(shipment);
};

/**
 * Status / ETA patch only.
 *
 * This is an ALLOW-list, not a deny-list, and that is deliberate. The mitigate
 * endpoint recomputes cost from the shipment's own fields, so ANY writable
 * field that feeds pricing (`weightKg`, `laneId`, …) is a side channel around
 * the authority gate: patch the input, and the server honestly computes a
 * small cost that clears the limit. Only fields listed here may be written;
 * `appliedMitigation` and `activeEscalationId` remain writable solely through
 * the gated mitigate / escalation-approve endpoints.
 */
const PATCHABLE_FIELDS = ["status", "etaCurrent"] as const;

export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!store.findShipment(id)) {
    return Response.json(
      { error: "NOT_FOUND", message: "Shipment not found." },
      { status: 404 },
    );
  }
  const body = (await req.json()) as Record<string, unknown>;
  const illegal = Object.keys(body).filter(
    (k) => !(PATCHABLE_FIELDS as readonly string[]).includes(k),
  );
  if (illegal.length) {
    return Response.json(
      {
        error: "FORBIDDEN_FIELD",
        message: `${illegal.join(", ")} cannot be patched. Only ${PATCHABLE_FIELDS.join(", ")} are writable here; mitigations and escalations go through their own endpoints.`,
      },
      { status: 422 },
    );
  }
  return Response.json(store.updateShipment(id, body as Partial<Shipment>));
};
