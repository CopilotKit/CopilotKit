import * as store from "@/skins/logistics/data/store";

/**
 * BEAT 5, step 1 — raise the tower's watch flag on a shipment.
 *
 * A separate route rather than a field on `PATCH /shipments/[id]`, and
 * deliberately so: that PATCH is an ALLOW-list of `status` / `etaCurrent`
 * precisely because any writable field feeding the mitigate endpoint's pricing
 * is a side channel around the authority gate. Widening it for a demo write
 * would reopen that argument on the one endpoint whose narrowness is the point.
 *
 * `raisedBy` is DERIVED from the resolved planner, never read off the body —
 * same rule as `POST /decisions`. A client that could set it would be forging
 * who raised the flag.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const { reason, plannerId } = await req.json();
  const planner = plannerId ? store.findPlanner(plannerId) : undefined;
  if (!planner) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known plannerId is required." },
      { status: 400 },
    );
  }
  try {
    const shipment = store.raiseWatch(id, reason, planner.name);
    return Response.json(shipment, { status: 201 });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN";
    if (code === "NOT_FOUND") {
      return Response.json(
        { error: code, message: "Shipment not found." },
        { status: 404 },
      );
    }
    // The valid set IS named here, unlike an escalation refusal. This
    // vocabulary is given to the agent on purpose (see data/handling.ts), so
    // withholding it would only cost a round trip.
    return Response.json(
      {
        error: "INVALID_WATCH_REASON",
        message: `"${reason}" is not a watch reason.`,
      },
      { status: 422 },
    );
  }
};
