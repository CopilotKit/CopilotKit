import * as store from "@/skins/logistics/data/store";

/**
 * BEAT 5, step 3 — post a short note on the shipment record.
 *
 * The 🚨 marker is applied by the STORE (`markNote`), not by this route and not
 * by the caller: it is the only thing that makes the write legible from the back
 * of a room, so it must not be something a model can phrase its way out of.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const { text, plannerId } = await req.json();
  const planner = plannerId ? store.findPlanner(plannerId) : undefined;
  if (!planner) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known plannerId is required." },
      { status: 400 },
    );
  }
  try {
    const note = store.addShipmentNote(id, String(text ?? ""), planner.name);
    return Response.json(note, { status: 201 });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN";
    if (code === "NOT_FOUND") {
      return Response.json(
        { error: code, message: "Shipment not found." },
        { status: 404 },
      );
    }
    return Response.json(
      { error: "EMPTY_NOTE", message: "The note text is empty." },
      { status: 422 },
    );
  }
};
