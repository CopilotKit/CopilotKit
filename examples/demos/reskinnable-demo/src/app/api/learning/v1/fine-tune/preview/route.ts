import { json, preflight } from "@/skins/ledgerline/learning/http";
import * as store from "@/skins/ledgerline/learning/store";
import { preview } from "@/skins/ledgerline/learning/fine-tune";
import type { FineTuneTarget } from "@/skins/ledgerline/learning/fine-tune";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => {
  const t = new URL(req.url).searchParams.get("target");
  const target: FineTuneTarget =
    t === "sagemaker" ? "sagemaker" : "thinking-machines";
  return json(preview(target, store.learnableTrajectory()));
};
export const OPTIONS = preflight;
