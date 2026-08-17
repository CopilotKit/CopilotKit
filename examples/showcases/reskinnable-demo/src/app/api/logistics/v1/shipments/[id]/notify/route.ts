import * as store from "@/skins/logistics/data/store";

/**
 * BEAT 5, step 2 — send the shipment's carrier a templated message.
 *
 * `sentBy` is derived from the resolved planner and the CARRIER is copied off
 * the shipment inside the store, so neither the actor nor the recipient can be
 * whatever the model happened to type.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const { template, plannerId } = await req.json();
  const planner = plannerId ? store.findPlanner(plannerId) : undefined;
  if (!planner) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known plannerId is required." },
      { status: 400 },
    );
  }
  try {
    const notice = store.sendCarrierNotice(id, template, planner.name);
    return Response.json(notice, { status: 201 });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN";
    if (code === "NOT_FOUND") {
      return Response.json(
        { error: code, message: "Shipment not found." },
        { status: 404 },
      );
    }
    return Response.json(
      {
        error: "INVALID_CARRIER_MESSAGE",
        message: `"${template}" is not a carrier message template.`,
      },
      { status: 422 },
    );
  }
};
