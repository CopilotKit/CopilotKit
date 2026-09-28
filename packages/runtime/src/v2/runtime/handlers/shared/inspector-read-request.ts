import { z } from "zod";

export interface InspectorReadRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/** Accepts only the product read operations exposed to embedded Inspector. */
export function parseInspectorReadRequest(
  value: unknown,
): InspectorReadRequest | null {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return null;
  const request: InspectorReadRequest = {
    method: parsed.data.method,
    path: parsed.data.path,
    ...(parsed.data.query === undefined ? {} : { query: parsed.data.query }),
    ...(parsed.data.body === undefined ? {} : { body: parsed.data.body }),
  };
  if (request.method === "POST") {
    return ["/api/v1/metrics/query", "/api/v1/exports"].includes(request.path)
      ? request
      : null;
  }
  if (request.body !== undefined) return null;
  if (READ_PATHS.has(request.path)) return request;
  if (
    /^\/api\/v1\/exports\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:\/content)?$/iu.test(
      request.path,
    )
  )
    return request;
  const match =
    /^\/api\/v1\/(?:tools\/([^/]+)|conversations\/([^/]+)\/replay|governance\/runs\/([^/]+)|learning\/skills\/([^/]+)\/(?:lineage|runs)|learning\/insights\/([^/]+)\/conversations)$/u.exec(
      request.path,
    );
  if (!match) return null;
  const segment = match.slice(1).find((item) => item !== undefined);
  if (!segment || !/^(?:[\w.~-]|%[\da-fA-F]{2})+$/u.test(segment)) return null;
  try {
    const decoded = decodeURIComponent(segment);
    if (
      decoded === "." ||
      decoded === ".." ||
      /[/\\%?#]/u.test(decoded) ||
      [...decoded].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      return null;
    return request;
  } catch {
    return null;
  }
}

const requestSchema = z
  .object({
    method: z.enum(["GET", "POST"]),
    path: z.string().min(1).max(2048),
    query: z
      .record(z.string().min(1).max(64), z.string().max(4096))
      .refine((query) => Object.keys(query).length <= 20)
      .optional(),
    body: z.unknown().optional(),
  })
  .strict();

const READ_PATHS: ReadonlySet<string> = new Set([
  "/context",
  "/api/v1/metrics",
  "/api/v1/runs",
  "/api/v1/tools",
  "/api/v1/conversations",
  "/api/v1/events",
  "/api/v1/governance/events",
  "/api/v1/governance/summary",
  "/api/v1/governance/approvals",
  "/api/v1/governance/access",
  "/api/v1/governance/deletions",
  "/api/v1/learning/insights",
  "/api/v1/learning/skills",
  "/api/v1/learning/topics",
]);
