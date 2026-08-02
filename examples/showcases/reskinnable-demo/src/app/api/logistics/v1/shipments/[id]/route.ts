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
 * `appliedMitigation` and `activeEscalationId` are writable ONLY through the
 * gated endpoints (mitigate / escalations-approve). Without this guard a
 * caller could PATCH them directly and route straight around the authority
 * check, making the whole gate theater.
 */
const GATED_FIELDS = ["appliedMitigation", "activeEscalationId"] as const;

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
  const body = (await req.json()) as Partial<Shipment>;
  const attempted = GATED_FIELDS.filter((f) => f in body);
  if (attempted.length) {
    return Response.json(
      {
        error: "FORBIDDEN_FIELD",
        message: `${attempted.join(", ")} can only be set through the mitigate or escalation endpoints.`,
      },
      { status: 422 },
    );
  }
  return Response.json(store.updateShipment(id, body));
};
