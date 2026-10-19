import { CORS, preflight } from "@/skins/ledgerline/learning/http";
import * as store from "@/skins/ledgerline/learning/store";
import { jsonl } from "@/skins/ledgerline/learning/fine-tune";
import type { FineTuneTarget } from "@/skins/ledgerline/learning/fine-tune";

export const dynamic = "force-dynamic";
/** The preview's dataset as a JSONL download (additive; no upload happens). */
export const GET = (req: Request) => {
  const t = new URL(req.url).searchParams.get("target");
  const target: FineTuneTarget =
    t === "sagemaker" ? "sagemaker" : "thinking-machines";
  return new Response(`${jsonl(target, store.learnableTrajectory())}\n`, {
    headers: {
      ...CORS,
      "content-type": "application/jsonl; charset=utf-8",
      "content-disposition": `attachment; filename="ledgerline-${target}.jsonl"`,
    },
  });
};
export const OPTIONS = preflight;
