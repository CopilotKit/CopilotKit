import { json, preflight, fail } from "@/skins/ledgerline/learning/http";
import { approveSkill } from "@/skins/ledgerline/learning/service";

/** Publish a skill: the in-app agent and the MCP server pick it up on their next read. */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) => {
  try {
    return json(await approveSkill((await params).name));
  } catch (error) {
    return fail(error, "skills approve");
  }
};
export const OPTIONS = preflight;
