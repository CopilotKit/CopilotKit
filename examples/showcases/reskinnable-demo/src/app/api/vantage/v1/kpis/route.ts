import * as store from "@/skins/vantage/data/store";
import { computeKpis, resolveMetricIds } from "@/skins/vantage/data/derive";
import { parseLens } from "@/skins/vantage/data/lens";

/**
 * `?metrics=nrr,magic_number` selects which KPIs to compute; omit it for the
 * default four. The board canvas uses it so a tile the agent asked for exists
 * in the response — without it a StatCard for a non-default metric finds
 * nothing and silently disappears.
 */
export const GET = async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const db = store.all();
  const lens = parseLens(params);
  const metrics = resolveMetricIds(db, params.get("metrics"));
  return Response.json({ lens, metrics, kpis: computeKpis(db, lens, metrics) });
};
