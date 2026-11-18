import { json, preflight } from "@/skins/ledgerline/learning/http";
import * as store from "@/skins/ledgerline/learning/store";

export const dynamic = "force-dynamic";
export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const d = store.trajectoryDetail((await params).id);
  return d
    ? json(d)
    : json({ error: "NOT_FOUND", message: "No such trajectory." }, 404);
};
export const OPTIONS = preflight;
