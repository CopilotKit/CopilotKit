import * as store from "@/skins/logistics/data/store";

export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    return Response.json(store.approveEscalation(id));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "UNKNOWN";
    const status = reason === "NOT_FOUND" ? 404 : 409;
    return Response.json(
      {
        error: reason,
        message: `Could not approve the escalation (${reason}).`,
      },
      { status },
    );
  }
};
