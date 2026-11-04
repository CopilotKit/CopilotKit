import * as store from "@/skins/logistics/data/store";
import { computeMitigationOptions } from "@/skins/logistics/data/mitigation-options";

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
  return Response.json(computeMitigationOptions(shipment, store.lanes()));
};
