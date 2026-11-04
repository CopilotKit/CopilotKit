import { body, fail, json, preflight } from "@/skins/ledgerline/learning/http";
import { deliver, preview } from "@/intelligence-ui/export/server";
import { parseSlice } from "@/intelligence-ui/export/model";
import type { DestinationKind } from "@/intelligence-ui/export/model";

/**
 * Trajectory export (additive to CONTRACT.md).
 * GET  ?space&scope&group&user&q&format  the slice: counts, rows, a raw record.
 * POST { ...same as query params, destination, uri }  deliver it (recorded, not sent).
 */
export const dynamic = "force-dynamic";

export const GET = (req: Request) => {
  try {
    const { scope, filters, format } = parseSlice(
      new URL(req.url).searchParams,
    );
    return json(preview(scope, filters, format));
  } catch (error) {
    return fail(error, "exports preview");
  }
};

const DESTINATIONS: readonly DestinationKind[] = [
  "s3",
  "gcs",
  "snowflake",
  "databricks",
  "webhook",
];

export const POST = async (req: Request) => {
  try {
    const b = await body(req);
    const params = new URLSearchParams();
    for (const k of ["space", "scope", "group", "user", "q", "format"])
      if (typeof b[k] === "string") params.set(k, b[k] as string);
    const { scope, filters, format } = parseSlice(params);
    const destination = DESTINATIONS.find((d) => d === b.destination);
    const uri = typeof b.uri === "string" ? b.uri.trim() : "";
    if (!destination || !uri)
      return json(
        { error: "BAD_REQUEST", message: "destination and uri are required." },
        400,
      );
    return json(deliver({ scope, filters, format, destination, uri }));
  } catch (error) {
    return fail(error, "exports deliver");
  }
};
export const OPTIONS = preflight;
