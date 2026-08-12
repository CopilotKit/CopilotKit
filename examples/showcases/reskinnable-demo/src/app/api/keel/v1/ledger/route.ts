import * as store from "@/skins/keel/data/store";
import { KEEL_PERSONAS } from "@/skins/keel/data/personas";
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
 */
export const GET = async () => {
  const ledger: KeelLedger = {
    documents: store.documents(),
    runs: store.runs(),
    playbooks: store.playbooks(),
    personas: KEEL_PERSONAS,
    variances: store.variances(),
    impactBriefs: store.impactBriefs(),
    asOf: new Date().toISOString(),
  };
  return Response.json(ledger);
};
