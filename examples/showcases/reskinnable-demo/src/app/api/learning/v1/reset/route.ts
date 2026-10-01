import { json, preflight } from "@/skins/ledgerline/learning/http";
import { resetAll } from "@/skins/ledgerline/learning/service";

/** Restore seed data: the expense ledger, the earlier trajectories, no capture from today, no skill. */
export const POST = () => {
  resetAll();
  return json({
    ok: true,
    reset: ["ledger", "trajectories", "insights", "skills", "evalCandidates"],
  });
};
export const OPTIONS = preflight;
