import * as store from "@/skins/keel/data/store";
import { settleRuns } from "@/app/api/keel/v1/settle-runs";

/**
 * The per-run read that serves the parameterized route `/<skin>/runs/<runId>`.
 *
 * ⚠️ IT SETTLES FIRST, exactly as `GET /ledger` does and through the same
 * `settleRuns()`. Both read routes or neither: the register poll and this page
 * poll independently, so a route that returned unsettled runs would have the run
 * detail sitting still while the Runs table advanced — one run, two clocks, one
 * of them wrong. See `../../settle-runs.ts` for why time lives on the server.
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
  settleRuns();
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
