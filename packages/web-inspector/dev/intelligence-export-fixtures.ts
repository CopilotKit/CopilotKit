import { randomUUID } from "node:crypto";
import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";

interface FixtureJob {
  readonly id: string;
  readonly kind: string;
  readonly format: string;
  readonly from: string;
  readonly to: string;
  readonly filters: Record<string, unknown>;
}
const jobs = new Map<string, FixtureJob>();

/** Serves local export jobs and downloadable fixtures through the real host transport. */
export function intelligenceExportFixture(
  request: IntelligenceReadRequest,
):
  | { status: number; body: unknown; contentType?: string; metadata?: unknown }
  | undefined {
  if (request.path === "/api/v1/exports" && request.method === "POST") {
    if (typeof request.body !== "object" || request.body === null)
      return { status: 400, body: {} };
    const body = request.body;
    if (
      !("kind" in body) ||
      !("format" in body) ||
      !("from" in body) ||
      !("to" in body)
    )
      return { status: 400, body: {} };
    const job: FixtureJob = {
      id: randomUUID(),
      kind: String(body.kind),
      format: String(body.format),
      from: String(body.from),
      to: String(body.to),
      filters:
        "filters" in body &&
        typeof body.filters === "object" &&
        body.filters !== null
          ? Object.fromEntries(Object.entries(body.filters))
          : {},
    };
    if (jobs.size >= 20) jobs.clear();
    jobs.set(job.id, job);
    return { status: 202, body: exportJob(job, false) };
  }
  const match = /^\/api\/v1\/exports\/([^/]+)(\/content)?$/u.exec(request.path);
  if (!match?.[1]) return undefined;
  const job = jobs.get(match[1]);
  if (!job) return { status: 404, body: {} };
  if (!match[2]) return { status: 200, body: exportJob(job, true) };
  const metadata = exportJob(job, true).metadata;
  const runId =
    job.filters.outcome === "error" ? "fixture-run-2" : "fixture-run-1";
  const rows = [{ runId, tokens: 840 }];
  return {
    status: 200,
    body:
      job.format === "csv"
        ? `runId,tokens\r\n${runId},840\r\n`
        : JSON.stringify({ metadata, data: rows }),
    contentType:
      job.format === "csv" ? "text/csv; charset=utf-8" : "application/json",
    metadata,
  };
}

/** Shapes a queued or completed fixture job using the public export fields. */
function exportJob(job: FixtureJob, completed: boolean) {
  const now = new Date().toISOString();
  const metadata = {
    exportId: job.id,
    kind: job.kind,
    format: job.format,
    definitions: [
      { name: "runId", description: "Run identifier" },
      { name: "tokens", description: "Total reported tokens" },
    ],
    filters: job.filters,
    from: job.from,
    to: job.to,
    captureStartedAt: "2026-09-01T00:00:00.000Z",
    generatedAt: now,
    rowCount: 1,
    rowLimit: 100000,
    truncated: false,
    truncatedReason: null,
  };
  return {
    ...job,
    status: completed ? "completed" : "queued",
    requestedBy: { type: "operator", id: "fixture-reviewer" },
    rowCount: completed ? 1 : null,
    truncated: false,
    truncatedReason: null,
    byteSize: completed ? 100 : null,
    errorCode: null,
    createdAt: now,
    startedAt: completed ? now : null,
    completedAt: completed ? now : null,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    metadata: completed ? metadata : null,
  };
}
