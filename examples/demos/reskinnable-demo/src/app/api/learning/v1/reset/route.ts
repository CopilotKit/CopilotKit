import { json, preflight } from "@/skins/ledgerline/learning/http";
import { resetAll } from "@/skins/ledgerline/learning/service";
import { clearImports } from "@/eval-platform/imports-store";
import { clearJobs } from "@/intelligence-ui/export/server";

/** Restore seed data: the expense ledger, the earlier trajectories, no capture from today, no skill. */
export const POST = () => {
  resetAll();
  clearImports(); // cases exported to the /eval-platform stand-in
  clearJobs(); // trajectory exports from the Data export screen
  return json({
    ok: true,
    reset: [
      "ledger",
      "trajectories",
      "insights",
      "skills",
      "evalCandidates",
      "evalImports",
      "trajectoryExports",
    ],
  });
};
export const OPTIONS = preflight;
