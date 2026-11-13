import { json, preflight } from "@/skins/ledgerline/learning/http";
import * as store from "@/skins/ledgerline/learning/store";

export const dynamic = "force-dynamic";
/** One skill by name (additive): what the agent's loadLearnedSkill reads. */
export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) => {
  const skill = store.getSkill((await params).name);
  return skill
    ? json(skill)
    : json({ error: "NOT_FOUND", message: "No such skill." }, 404);
};
export const OPTIONS = preflight;
