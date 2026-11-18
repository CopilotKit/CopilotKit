import { json, preflight, fail } from "@/skins/ledgerline/learning/http";
import { disableSkill } from "@/skins/ledgerline/learning/service";

export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) => {
  try {
    return json(disableSkill((await params).name));
  } catch (error) {
    return fail(error, "skills disable");
  }
};
export const OPTIONS = preflight;
