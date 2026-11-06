import * as store from "@/skins/keel/data/store";
import { KEEL_PERSONAS } from "@/skins/keel/data/personas";
import { settleRuns } from "@/app/api/keel/v1/settle-runs";
import type { KeelLedger } from "@/skins/keel/data/types";

/**
 * THE snapshot read. One request, one instant.
 *
 * Every REST-backed skin in this app fetches its whole world in a single call
 * rather than a page's worth of chatty reads, and the reason is not request
 * count: a page that fetched documents, then runs, then variances would have its
 * KPI strip, its rows and its agent readable each describing a slightly
 * different moment, and the drift would show up as an agent confidently
 * narrating a figure the screen no longer shows.
 *
 * `playbooks` and `personas` ride along even though they never change, so the
 * client needs exactly one fetch to mount. `asOf` is here so a consumer can say
 * WHEN, rather than implying "now" about a snapshot it has been holding.
 *
 * ⚠️ RUNS ARE SETTLED ON READ, not read raw — `settleRuns()` advances them
 * through the pure `engine.tick` at `Date.now()` and commits the result. That is
 * the whole of the client's clock: the provider's 900 ms poll re-reads THIS
 * route and never ticks anything itself. `GET /runs/<runId>` settles through the
 * same function, or the run-detail page and this snapshot would describe
 * different moments of the same run. See `../settle-runs.ts`.
 */
export const GET = async () => {
  const ledger: KeelLedger = {
    documents: store.documents(),
    runs: settleRuns(),
    playbooks: store.playbooks(),
    personas: KEEL_PERSONAS,
    variances: store.variances(),
    impactBriefs: store.impactBriefs(),
    asOf: new Date().toISOString(),
  };
  return Response.json(ledger);
};
