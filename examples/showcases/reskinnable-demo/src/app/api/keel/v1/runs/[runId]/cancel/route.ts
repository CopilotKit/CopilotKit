import * as store from "@/skins/keel/data/store";

/**
 * Cancel a run.
 *
 * No persona required, unlike every other write here, and that is deliberate
 * rather than an oversight: cancelling is not an approval and carries no
 * `approverRole`, so demanding one would imply an authority check this action
 * does not have. The engine still refuses a run that is already completed or
 * cancelled, which is the only rule there is.
 */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) => {
  const { runId } = await params;
  const result = store.cancelRun(runId);
  if (!result.ok) {
    const missing = result.reason?.includes("not found") ?? false;
    return Response.json(
      {
        error: missing ? "NOT_FOUND" : "RUN_NOT_CANCELLABLE",
        message: result.reason,
      },
      { status: missing ? 404 : 409 },
    );
  }
  return Response.json(result.run);
};
