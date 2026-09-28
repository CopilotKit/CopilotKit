import { randomUUID } from "node:crypto";
import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";
import { intelligenceLearningFixture } from "./intelligence-learning-fixtures.js";

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
  const rows = exportRows(job);
  const columns = exportColumns(job);
  return {
    status: 200,
    body:
      job.format === "csv"
        ? [
            columns.join(","),
            ...rows.map((row) =>
              columns.map((column) => csvCell(row[column])).join(","),
            ),
          ].join("\r\n") + "\r\n"
        : JSON.stringify({ metadata, data: rows }),
    contentType:
      job.format === "csv" ? "text/csv; charset=utf-8" : "application/json",
    metadata,
  };
}

/** Shapes a queued or completed fixture job using the public export fields. */
function exportJob(job: FixtureJob, completed: boolean) {
  const now = new Date().toISOString();
  const rows = exportRows(job);
  const metadata = {
    exportId: job.id,
    kind: job.kind,
    format: job.format,
    definitions: exportColumns(job).map((name) => ({
      name,
      description: `Recorded ${name}`,
    })),
    filters: job.filters,
    from: job.from,
    to: job.to,
    captureStartedAt: "2026-09-01T00:00:00.000Z",
    generatedAt: now,
    rowCount: rows.length,
    rowLimit: 100000,
    truncated: false,
    truncatedReason: null,
  };
  return {
    ...job,
    status: completed ? "completed" : "queued",
    requestedBy: { type: "operator", id: "fixture-reviewer" },
    rowCount: completed ? rows.length : null,
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

/** Reuses the Learning list fixture so export scope and screen scope match. */
function exportRows(job: FixtureJob): Record<string, unknown>[] {
  if (job.kind !== "insights")
    return [
      {
        runId:
          job.filters.outcome === "error" ? "fixture-run-2" : "fixture-run-1",
        tokens: 840,
      },
    ];
  const response = intelligenceLearningFixture({
    method: "GET",
    path: "/api/v1/learning/insights",
    query: {
      from: job.from,
      to: job.to,
      ...(typeof job.filters.agentId === "string"
        ? { agentId: job.filters.agentId }
        : {}),
    },
  });
  if (
    !isRecord(response) ||
    !Array.isArray(response.data) ||
    !response.data.every(isRecord)
  )
    throw new Error("Invalid Insight fixture");
  return response.data;
}

/** Stable columns also describe empty Insight exports. */
function exportColumns(job: FixtureJob): string[] {
  return job.kind === "insights"
    ? [
        "id",
        "containerId",
        "statement",
        "impact",
        "relatedTopic",
        "contributingConversations",
        "createdAt",
        "learningRunId",
        "status",
        "archivedAt",
      ]
    : ["runId", "tokens"];
}

/** Quotes CSV delimiters and prevents spreadsheet formulas in fixture text. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Narrows fixture objects without coercing their contents. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
