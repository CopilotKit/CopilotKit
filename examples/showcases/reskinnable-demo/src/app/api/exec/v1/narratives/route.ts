import { z } from "zod";
import * as store from "@/skins/exec/data/store";

// Zod schemas can't import TS types at runtime, so this mirrors the `MetricId`
// union in ../../../../skins/exec/data/types.ts by hand — exactly as
// src/skins/exec/catalog/definitions.ts and src/skins/exec/agent.ts do.
const metricId = z.enum([
  "revenue",
  "growthQoQ",
  "growthYoY",
  "operatingMargin",
  "ebitda",
  "cash",
  "runwayMonths",
  "nps",
  "burnRate",
  "arAgingDays",
  "dsoDays",
  "opex",
  "headcountCost",
  "forecastAccuracy",
]);

const FileNarrativeBody = z.object({
  metricId,
  period: z.string(),
  code: z.enum(["VAR-TIMING", "VAR-ONEOFF", "VAR-FX", "VAR-PLAN"]),
  body: z.string(),
  source: z.enum(["typed", "ingested-memo"]).default("typed"),
});

export const POST = async (req: Request) => {
  const raw = await req.json().catch(() => null);
  const parsed = FileNarrativeBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: "Invalid narrative payload.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const filed = store.fileNarrative(parsed.data);
  return Response.json(filed, { status: 201 });
};
