import { json, preflight } from "@/skins/ledgerline/learning/http";
import * as store from "@/skins/ledgerline/learning/store";
import { withAguiEvents } from "@/intelligence-ui/agui/synthesize";
import { seedDetail } from "@/intelligence-ui/seed/history";
import type { TrajectoryDetail } from "@/intelligence-ui/data/contract";

/**
 * One trajectory with each Thread's AG-UI event stream (`threads[].aguiEvents`),
 * for the Intelligence trajectory view and its Export. Covers today's captured
 * trajectories (read-only from the learning store) and the seeded history.
 */
export const dynamic = "force-dynamic";

export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const id = (await params).id;
  const detail =
    (store.trajectoryDetail(id) as TrajectoryDetail | null) ?? seedDetail(id);
  if (!detail)
    return json({ error: "NOT_FOUND", message: "No such trajectory." }, 404);
  return json({ ...withAguiEvents(detail), exportedAt: Date.now() });
};
export const OPTIONS = preflight;
