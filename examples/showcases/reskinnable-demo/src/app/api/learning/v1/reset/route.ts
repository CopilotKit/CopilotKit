import { json, preflight } from "@/skins/ledgerline/learning/http";
import { resetAll } from "@/skins/ledgerline/learning/service";
import { clearImports } from "@/eval-platform/imports-store";

/** Restore seed data: the expense ledger, the earlier trajectories, no capture from today, no skill. */
export const POST = () => {
  resetAll();
  clearImports(); // cases exported to the /eval-platform stand-in
  return json({
    ok: true,
    reset: [
      "ledger",
      "trajectories",
      "insights",
      "skills",
      "evalCandidates",
      "evalImports",
    ],
  });
};
export const OPTIONS = preflight;
