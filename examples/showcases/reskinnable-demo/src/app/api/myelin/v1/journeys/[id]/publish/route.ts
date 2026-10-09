import * as store from "@/skins/myelin/data/store";
import { actorFrom, errorResponse } from "@/skins/myelin/data/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  try {
    return Response.json(store.publish(id, actorFrom(req)));
  } catch (error) {
    // A blocked publish carries the SYMPTOM in numbers (how many learners, which
    // journey they are already in) — never the rule that would clear it.
    if (error instanceof Error && error.message === "AUDIENCE_OVERLAP") {
      const conflicts = store.unresolvedConflicts(id).map((c) => ({
        otherJourneyName: c.otherJourneyName,
        overlappingLearners: c.learnerIds.length,
        weeklyMinutesIfConcurrent: c.weeklyMinutesIfConcurrent,
        policy: c.policy,
      }));
      return errorResponse(error, { conflicts });
    }
    return errorResponse(error);
  }
}
