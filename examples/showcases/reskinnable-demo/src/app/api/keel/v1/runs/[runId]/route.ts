import * as store from "@/skins/keel/data/store";

/**
 * The per-run read that serves the parameterized route `/<skin>/runs/<runId>`.
 *
 * `playbook` rides along because the run detail page renders the playbook's
 * summary and inputs beside the live steps, and fetching it separately would let
 * the two describe different moments. A run whose playbook has been removed
 * still returns — `playbook: null` — because the run's own steps are a snapshot
 * taken at start and remain renderable without it.
 */
export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) => {
  const { runId } = await params;
  const run = store.findRun(runId);
  if (!run) {
    return Response.json(
      { error: "NOT_FOUND", message: "That run was not found." },
      { status: 404 },
    );
  }
  return Response.json({
    run,
    playbook: store.findPlaybook(run.playbookId) ?? null,
  });
};
