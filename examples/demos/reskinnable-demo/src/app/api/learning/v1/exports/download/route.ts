import { CORS, preflight } from "@/skins/ledgerline/learning/http";
import { body } from "@/intelligence-ui/export/server";
import { parseSlice } from "@/intelligence-ui/export/model";

export const dynamic = "force-dynamic";
/** The slice as a file: JSONL (full raw records) or CSV (one row per trajectory). */
export const GET = (req: Request) => {
  const { scope, filters, format } = parseSlice(new URL(req.url).searchParams);
  const kind = format === "csv" ? "csv" : "jsonl";
  const day = new Date().toISOString().slice(0, 10);
  return new Response(body(scope, filters, kind), {
    headers: {
      ...CORS,
      "content-type":
        kind === "csv"
          ? "text/csv; charset=utf-8"
          : "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="${scope.space}-trajectories-${day}.${kind}"`,
    },
  });
};
export const OPTIONS = preflight;
