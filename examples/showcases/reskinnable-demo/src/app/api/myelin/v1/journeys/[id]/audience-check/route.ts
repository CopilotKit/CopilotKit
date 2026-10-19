import * as store from "@/skins/myelin/data/store";
import { errorResponse } from "@/skins/myelin/data/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The pre-publish audience check. Learner ids are returned for the browser's
 * governance card, which resolves them to names client-side; the agent's tool
 * strips them (see agent-myelin), so no learner name ever enters the model's
 * context.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const id = (await params).id;
    const journey = store.journey(id);
    return Response.json({
      journeyId: id,
      audienceSize: store.audienceSize(journey),
      totalMinutes: store.totalMinutes(journey),
      conflicts: store.audienceConflicts(id),
      unresolved: store.unresolvedConflicts(id).length,
      rulesApplied: journey.audienceRules.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
