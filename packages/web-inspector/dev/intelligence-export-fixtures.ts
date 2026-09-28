import { randomUUID } from "node:crypto";
import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";
import { intelligenceLearningFixture } from "./intelligence-learning-fixtures.js";
import { intelligenceFixture } from "./intelligence-state-lab.js";
import { intelligenceContentFixture } from "./intelligence-content-fixtures.js";
import { intelligenceAnalyticsFixture } from "./intelligence-analytics-fixtures.js";

import { intelligenceGovernanceFixture } from "./intelligence-governance-fixtures.js";

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
              columns
                .map((column) => csvCell(exportValue(job, row, column)))
                .join(","),
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

/** Reuses list fixtures so export scope and screen scope match. */
function exportRows(job: FixtureJob): Record<string, unknown>[] {
  if (job.kind === "model_usage") return modelUsageRows(job);
  if (
    job.kind !== "insights" &&
    job.kind !== "skills" &&
    job.kind !== "activity" &&
    job.kind !== "events" &&
    job.kind !== "tools" &&
    job.kind !== "runs" &&
    job.kind !== "tool_calls"
  )
    return [
      {
        runId:
          job.filters.outcome === "error" ? "fixture-run-2" : "fixture-run-1",
        tokens: 840,
      },
    ];
  const query = {
    from: job.from,
    to: job.to,
    ...(job.kind === "runs" && typeof job.filters.limit === "number"
      ? { limit: String(job.filters.limit) }
      : {}),
    ...Object.fromEntries(
      Object.entries(job.filters).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };
  if (job.kind === "tool_calls") return toolCallExportRows(job, query);
  const response =
    job.kind === "runs"
      ? intelligenceFixture({ method: "GET", path: "/api/v1/runs", query }).body
      : job.kind === "tools"
        ? intelligenceContentFixture({
            method: "GET",
            path: "/api/v1/tools",
            query,
          })
        : job.kind === "events"
          ? intelligenceAnalyticsFixture({
              method: "GET",
              path: "/api/v1/events",
              query,
            })
          : job.kind === "activity"
            ? intelligenceGovernanceFixture({
                method: "GET",
                path: "/api/v1/governance/events",
                query,
              })
            : intelligenceLearningFixture({
                method: "GET",
                path:
                  job.kind === "skills"
                    ? "/api/v1/learning/skills"
                    : "/api/v1/learning/insights",
                query,
              });
  if (
    !isRecord(response) ||
    !Array.isArray(response.data) ||
    !response.data.every(isRecord)
  )
    throw new Error("Invalid export fixture");
  if (job.kind === "activity")
    return response.data.map((row) => {
      const actor = isRecord(row.actor) ? row.actor : {};
      return Object.fromEntries(
        exportColumns(job).map((column) => [
          column,
          column === "actorType"
            ? actor.type
            : column === "actorId"
              ? actor.id
              : column === "details"
                ? JSON.stringify(row.details)
                : row[column],
        ]),
      );
    });
  if (job.kind === "events")
    return response.data.map((row) =>
      Object.fromEntries(
        exportColumns(job).map((column) => [column, row[column]]),
      ),
    );
  return response.data;
}

/** Stable columns match each fixture export, including empty files. */
function exportColumns(job: FixtureJob): string[] {
  if (job.kind === "model_usage")
    return [
      "model",
      "runs",
      "tokensIn",
      "tokensOut",
      "avgResponseMs",
      "failedRuns",
      "previousRuns",
      "previousTokensIn",
      "previousTokensOut",
      "previousAvgResponseMs",
      "previousFailedRuns",
      "previousWindowFullyCaptured",
    ];
  if (job.kind === "runs")
    return [
      "runId",
      "threadId",
      "agentId",
      "userId",
      "startedAt",
      "endedAt",
      "outcome",
      "durationMs",
      "tokensIn",
      "tokensOut",
      "tokensTotal",
      "model",
      "toolCalls",
    ];
  if (job.kind === "tool_calls")
    return [
      "time",
      "toolCallId",
      "toolName",
      "runId",
      "threadId",
      "agentId",
      "outcome",
      "durationMs",
    ];
  if (job.kind === "tools")
    return [
      "toolName",
      "calls",
      "errors",
      "successRate",
      "avgMs",
      "medianMs",
      "lastCalledAt",
    ];
  if (job.kind === "skills")
    return [
      "id",
      "name",
      "containerId",
      "status",
      "createdAt",
      "version",
      "skillVersionId",
      "registryRevision",
      "reviewer",
      "reviewedAt",
      "deliveryEnabled",
      "deliveryChangedBy",
      "deliveryChangedAt",
      "loadEvents",
      "runsLoaded",
      "loadsFrom",
      "loadsTo",
    ];

  if (job.kind === "events")
    return [
      "id",
      "occurredAt",
      "type",
      "agentId",
      "runId",
      "threadId",
      "toolName",
      "outcome",
      "model",
      "tokens",
      "tokensIn",
      "tokensOut",
      "durationMs",
      "contentAvailable",
    ];
  if (job.kind === "activity")
    return [
      "id",
      "family",
      "type",
      "occurredAt",
      "receivedAt",
      "actorType",
      "actorId",
      "agentId",
      "threadId",
      "runId",
      "toolCallId",
      "toolName",
      "outcome",
      "source",
      "captureVersion",
      "details",
    ];
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

/** Projects Skill summary fields into the API's CSV columns without changing JSON rows. */
function exportValue(
  job: FixtureJob,
  row: Record<string, unknown>,
  column: string,
): unknown {
  if (job.kind !== "skills") return row[column];
  const paths: Record<string, readonly string[]> = {
    version: ["liveVersion", "revision"],
    skillVersionId: ["liveVersion", "skillVersionId"],
    registryRevision: ["liveVersion", "registryRevision"],
    deliveryEnabled: ["delivery", "enabled"],
    deliveryChangedBy: ["delivery", "lastChangedBy"],
    deliveryChangedAt: ["delivery", "lastChangedAt"],
    loadEvents: ["loads", "count"],
    runsLoaded: ["loads", "runCount"],
    loadsFrom: ["loads", "from"],
    loadsTo: ["loads", "to"],
  };
  let value: unknown = row;
  for (const key of paths[column] ?? [column])
    value = isRecord(value) ? value[key] : undefined;
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : value;
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

/** Reads every matching fixture call and removes private content from both formats. */
function toolCallExportRows(
  job: FixtureJob,
  query: Readonly<Record<string, string>>,
): Record<string, unknown>[] {
  const tools = intelligenceContentFixture({
    method: "GET",
    path: "/api/v1/tools",
    query,
  });
  if (
    !isRecord(tools) ||
    !Array.isArray(tools.data) ||
    !tools.data.every(isRecord)
  )
    throw new Error("Invalid tools fixture");
  const names = query.toolName
    ? [query.toolName]
    : tools.data.map((row) => {
        if (typeof row.toolName !== "string")
          throw new Error("Invalid tool name");
        return row.toolName;
      });
  const rows: Record<string, unknown>[] = [];
  for (const name of names) {
    let cursor: string | undefined;
    do {
      const detail = intelligenceContentFixture({
        method: "GET",
        path: `/api/v1/tools/${encodeURIComponent(name)}`,
        query: { ...query, limit: "100", ...(cursor ? { cursor } : {}) },
      });
      if (
        !isRecord(detail) ||
        !isRecord(detail.recentCalls) ||
        !Array.isArray(detail.recentCalls.data) ||
        !detail.recentCalls.data.every(isRecord)
      )
        throw new Error("Invalid tool calls fixture");
      rows.push(
        ...detail.recentCalls.data.map((row) =>
          Object.fromEntries(
            exportColumns(job).map((column) => [column, row[column]]),
          ),
        ),
      );
      cursor =
        typeof detail.recentCalls.nextCursor === "string"
          ? detail.recentCalls.nextCursor
          : undefined;
    } while (cursor !== undefined);
  }
  return rows.sort((left, right) =>
    String(right.time).localeCompare(String(left.time)),
  );
}

/** Validates the fixture series at the same unknown boundary as the host reads. */
function modelSeries(
  value: unknown,
): { model: string | null; total: number | null }[] {
  if (!Array.isArray(value)) throw new Error("Missing model series");
  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isRecord(entry.dimensions) ||
      (typeof entry.dimensions.model !== "string" &&
        entry.dimensions.model !== null) ||
      (typeof entry.total !== "number" && entry.total !== null)
    )
      throw new Error("Invalid model series");
    return { model: entry.dimensions.model, total: entry.total };
  });
}

/** Uses the displayed metric fixtures for current and previous model totals. */
function modelUsageRows(job: FixtureJob): Record<string, unknown>[] {
  const rows = new Map<string | null, Record<string, unknown>>();
  for (const [metric, current, previous] of [
    ["runs", "runs", "previousRuns"],
    ["tokens_in", "tokensIn", "previousTokensIn"],
    ["tokens_out", "tokensOut", "previousTokensOut"],
    ["avg_response_ms", "avgResponseMs", "previousAvgResponseMs"],
    ["failed_runs", "failedRuns", "previousFailedRuns"],
  ] as const) {
    const response = intelligenceAnalyticsFixture({
      method: "POST",
      path: "/api/v1/metrics/query",
      body: {
        metric,
        dimensions: ["model"],
        from: job.from,
        to: job.to,
        compare: "previous_period",
        asOf: job.filters.asOf,
        filters: { agentId: job.filters.agentId },
      },
    });
    if (
      !isRecord(response) ||
      !isRecord(response.coverage) ||
      typeof response.coverage.captureStartedAt !== "string"
    )
      throw new Error("Invalid model coverage");
    const comparison = isRecord(response.comparison)
      ? modelSeries(response.comparison.series)
      : [];
    for (const series of modelSeries(response.series)) {
      const model = series.model;
      const row =
        rows.get(model) ??
        Object.fromEntries(exportColumns(job).map((column) => [column, null]));
      row.model = model;
      row[current] = series.total;
      row[previous] =
        comparison.find((entry) => entry.model === model)?.total ?? null;
      row.previousWindowFullyCaptured =
        Date.parse(response.coverage.captureStartedAt) <=
        Date.parse(job.from) * 2 - Date.parse(job.to);
      rows.set(model, row);
    }
  }
  return [...rows.values()];
}
