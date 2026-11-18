import { json, preflight, fail, body } from "@/skins/ledgerline/learning/http";
import { learn } from "@/skins/ledgerline/learning/service";

/**
 * Run learning over the latest captured trajectory. `{ "llm": false }` forces
 * the deterministic path. Returns { insights, skills, evalCandidates } plus
 * `derivedBy` (and `fallbackReason` when the LLM path was not used).
 */
export const POST = async (req: Request) => {
  try {
    const { llm } = await body(req);
    return json(await learn({ llm: llm === false ? false : undefined }));
  } catch (error) {
    return fail(error, "learn");
  }
};
export const OPTIONS = preflight;
