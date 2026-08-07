import * as store from "@/skins/vantage/data/store";
import {
  computeBreakdown,
  computeSeries,
  computeVarianceWaterfall,
} from "@/skins/vantage/data/derive";
import { parseLens } from "@/skins/vantage/data/lens";
import type { Dimension, MetricId } from "@/skins/vantage/data/types";

const METRICS: MetricId[] = [
  "arr",
  "nrr",
  "pipeline_coverage",
  "cac_payback",
  "logo_churn",
  "magic_number",
];
const DIMENSIONS: Dimension[] = ["segment", "region", "channel"];

/**
 * One lens in, three shapes out. The series, its dimensional breakdown and the
 * plan-variance waterfall all derive from the same lens, are pure functions over
 * ~570 seeded rows, and the Explore page needs all three at once — so a single
 * round trip beats three.
 */
export const GET = async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const lens = parseLens(params);
  const metricParam = params.get("metric") as MetricId | null;
  const metric =
    metricParam && METRICS.includes(metricParam) ? metricParam : "arr";
  const dimParam = params.get("dimension") as Dimension | null;
  const dimension =
    dimParam && DIMENSIONS.includes(dimParam) ? dimParam : "segment";
  const db = store.all();
  return Response.json({
    lens,
    series: computeSeries(db, lens, metric),
    breakdown: computeBreakdown(db, lens, metric, dimension),
    waterfall: computeVarianceWaterfall(db, lens),
  });
};
