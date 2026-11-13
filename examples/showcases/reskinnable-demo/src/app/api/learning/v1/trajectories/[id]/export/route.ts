import { json, preflight } from "@/skins/ledgerline/learning/http";
import * as store from "@/skins/ledgerline/learning/store";

export const dynamic = "force-dynamic";
/** The full trajectory as structured JSON, as a download. */
export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const id = (await params).id;
  const d = store.trajectoryDetail(id);
  if (!d)
    return json({ error: "NOT_FOUND", message: "No such trajectory." }, 404);
  return json(
    { exportedAt: Date.now(), format: "ledgerline.trajectory.v1", ...d },
    200,
    {
      "content-disposition": `attachment; filename="${id}.json"`,
    },
  );
};
export const OPTIONS = preflight;
