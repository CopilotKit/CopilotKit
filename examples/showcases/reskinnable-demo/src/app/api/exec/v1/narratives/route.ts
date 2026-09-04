import { z } from "zod";
import * as store from "@/skins/exec/data/store";
import type { NarrativeCode } from "@/skins/exec/data/types";

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

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * BEAT 6's WITHHELD VOCABULARY (see `agent.ts`'s `isNarrativeCode` doc
 * comment) applies to this route too: it is the one place an operator files
 * a narrative, and its 400 body is reachable by anything that can POST here
 * — including an agent probing the endpoint directly. `code` is therefore a
 * `z.string() + refine`, never a `z.enum`: a `z.enum` publishes the whole
 * catalogue into zod's own "Expected 'VAR-TIMING' | ... received ..."
 * message the instant a bad code is sent, which is exactly the leak this
 * guards against. The refusal below echoes back the REJECTED value (useful
 * for a retry) but never the accepted set.
 */
const NARRATIVE_CODES: readonly NarrativeCode[] = [
  "VAR-TIMING",
  "VAR-ONEOFF",
  "VAR-FX",
  "VAR-PLAN",
];
const isNarrativeCode = (value: string): value is NarrativeCode =>
  (NARRATIVE_CODES as readonly string[]).includes(value);

const FileNarrativeBody = z.object({
  metricId,
  period: z
    .string()
    .regex(PERIOD_RE, 'Period must be "YYYY-MM" (01–12), e.g. "2026-08".'),
  code: z.string().refine(isNarrativeCode, (value) => ({
    message: `"${value}" is not a recognised narrative code.`,
  })),
  // `.trim()` first so a whitespace-only body ("   ") still fails `.min(1)`
  // instead of filing an empty explanation that flips `explained` to true.
  body: z.string().trim().min(1, "Narrative body cannot be empty."),
  source: z.enum(["typed", "ingested-memo"]).default("typed"),
});

export const POST = async (req: Request) => {
  const raw = await req.json().catch(() => null);
  const parsed = FileNarrativeBody.safeParse(raw);
  if (!parsed.success) {
    const body = {
      error: "BAD_REQUEST",
      message: "Invalid narrative payload.",
      issues: parsed.error.issues,
    };
    // Defense in depth for the withheld vocabulary above: strip any zod
    // issue field that enumerates valid options (e.g. `invalid_enum_value`'s
    // `options`) before serializing, so a future schema change that
    // reintroduces a `code` enum can't reopen the leak through this route.
    const json = JSON.stringify(body, (key, value) =>
      key === "options" ? undefined : value,
    );
    return new Response(json, {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const filed = store.fileNarrative(parsed.data);
  return Response.json(filed, { status: 201 });
};
