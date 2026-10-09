import * as store from "@/skins/logistics/data/store";

export const GET = async () => Response.json(store.escalations());

export const POST = async (req: Request) => {
  const { shipmentId, code, rationale } = await req.json();
  try {
    return Response.json(
      store.openEscalation(shipmentId, code, rationale ?? ""),
      { status: 201 },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "UNKNOWN";
    if (reason === "NOT_FOUND") {
      return Response.json(
        { error: reason, message: "Shipment not found." },
        { status: 404 },
      );
    }
    return Response.json(
      {
        error: "INVALID_ESCALATION_CODE",
        message: `"${code}" is not a recognized escalation code.`,
      },
      { status: 422 },
    );
  }
};
