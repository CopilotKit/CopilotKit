import * as store from "@/skins/ledgerline/data/store";
import { POLICY_DOCS } from "@/skins/ledgerline/data/seed";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => {
  const q = new URL(req.url).searchParams.get("q");
  return Response.json(
    q ? store.searchPolicies(q) : { query: null, results: POLICY_DOCS },
  );
};
