/**
 * CORS + JSON for `/api/learning/v1/*`: the Intelligence screens (`/intelligence`
 * in this app, or a prototype on another origin) read these, so every answer carries
 * `access-control-allow-origin: *`.
 */
import { LearningError } from "./service";

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

export const json = (
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) => Response.json(body, { status, headers: { ...CORS, ...extra } });

export const preflight = async () =>
  new Response(null, { status: 204, headers: CORS });

export function fail(error: unknown, where: string): Response {
  if (error instanceof LearningError) {
    return json({ error: error.code, message: error.message }, error.status);
  }
  console.error(`[ledgerline/learning] ${where} failed`, error);
  return json(
    {
      error: "INTERNAL",
      message: error instanceof Error ? error.message : String(error),
    },
    500,
  );
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = (await req.json()) as unknown;
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
