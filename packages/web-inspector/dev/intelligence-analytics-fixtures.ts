import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";

/** Supplies bounded model, distribution and event fixtures for local UX checks. */
export function intelligenceAnalyticsFixture(
  request: IntelligenceReadRequest,
): unknown {
  const query = request.query ?? {};
  if (request.path === "/api/v1/events") {
    const rows = [
      "run.finished",
      "message.recorded",
      "tool_call.completed",
    ].map((type, index) => ({
      id: `fixture-event-${index}`,
      type,
      occurredAt: new Date(Date.now() - (index + 1) * 60000).toISOString(),
      agentId: "support",
      threadId: "fixture-thread-1",
      runId: "fixture-run-1",
      toolName: index === 2 ? "refund" : null,
      outcome: "success",
      model: "customer-model",
      tokens: 840,
      tokensIn: 720,
      tokensOut: 120,
      durationMs: 2100,
      contentAvailable: index === 1,
      ...(index === 1
        ? {
            content:
              "The duplicate charge is refunded. Your original order is unchanged.",
          }
        : {}),
    }));
    return {
      data: (query.order === "asc"
        ? rows.reduce<typeof rows>((ordered, row) => [row, ...ordered], [])
        : rows
      ).filter(
        (row) =>
          (!query.type || row.type === query.type) &&
          (!query.agentId || row.agentId === query.agentId) &&
          (!query.threadId || row.threadId === query.threadId) &&
          (!query.runId || row.runId === query.runId) &&
          (!query.toolName || row.toolName === query.toolName) &&
          (!query.outcome || row.outcome === query.outcome) &&
          (!query.from ||
            Date.parse(row.occurredAt) >= Date.parse(query.from)) &&
          (!query.to || Date.parse(row.occurredAt) < Date.parse(query.to)),
      ),
      nextCursor: null,
    };
  }
  if (
    request.path !== "/api/v1/metrics/query" ||
    typeof request.body !== "object" ||
    request.body === null
  )
    return undefined;
  const body = request.body;
  if (!("metric" in body) || !("from" in body) || !("to" in body))
    return undefined;
  const metric = String(body.metric);
  const from = String(body.from);
  const to = String(body.to);
  const byModel =
    "dimensions" in body &&
    Array.isArray(body.dimensions) &&
    body.dimensions.includes("model");
  if (!byModel && metric !== "response_time_distribution") return undefined;
  const totals: Record<string, number> = {
    runs: 12438,
    tokens_in: 143820,
    tokens_out: 45630,
    avg_response_ms: 2100,
    failed_runs: 24,
  };
  const total = totals[metric] ?? 12438;
  const series = byModel
    ? ["customer-model", "customer-model-fast"].map((model, index) => ({
        dimensions: { model },
        total:
          metric === "avg_response_ms"
            ? index === 0
              ? 2400
              : 1800
            : Math.round(total * (index === 0 ? 0.6 : 0.4)),
        points: [],
      }))
    : ["<1s", "1-2s", "2-5s", "5-10s", "10-30s", "30-60s", ">=60s"].map(
        (bucket, index) => ({
          dimensions: { responseTime: bucket },
          total: [3000, 4200, 3200, 1500, 420, 100, 18][index],
          points: [],
        }),
      );
  return {
    metric,
    unit: metric.includes("tokens")
      ? "tokens"
      : metric === "avg_response_ms"
        ? "milliseconds"
        : "count",
    grain: null,
    from,
    to,
    total,
    series,
    truncated: false,
    asOf: "fixture_v1",
    coverage: {
      captureStartedAt: "2026-09-01T00:00:00.000Z",
      windowFullyCaptured: true,
    },
  };
}
