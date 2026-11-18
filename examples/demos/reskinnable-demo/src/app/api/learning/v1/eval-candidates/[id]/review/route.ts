import { json, preflight, fail, body } from "@/skins/ledgerline/learning/http";
import { reviewEvalCandidate } from "@/skins/ledgerline/learning/service";

export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { decision } = await body(req);
    return json(reviewEvalCandidate((await params).id, decision));
  } catch (error) {
    return fail(error, "eval-candidates review");
  }
};
export const OPTIONS = preflight;
