import { intelligenceAnalyticsFixture } from "./intelligence-analytics-fixtures.js";
import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";

/** Supplies a fixed, labeled workbench answer without calling an external model. */
export function intelligenceAskFixture(
  request: IntelligenceReadRequest,
): unknown | undefined {
  if (
    request.path !== "/ask" ||
    request.method !== "POST" ||
    !request.body ||
    typeof request.body !== "object"
  )
    return undefined;
  const body = request.body;
  if (!("from" in body) || !("to" in body)) return undefined;
  const from = String(body.from);
  const to = String(body.to);
  const filters =
    "agentId" in body && typeof body.agentId === "string"
      ? { agentId: body.agentId }
      : {};
  if (
    "question" in body &&
    /approvals.*rejections.*user/i.test(String(body.question))
  ) {
    return {
      version: 1,
      text: "Verified approvals and rejections by user.",
      results: (
        [
          ["approvals", "reviewer-1"],
          ["rejections", "reviewer-6"],
        ] as const
      ).map(([metric, user]) => {
        const series =
          !filters.agentId || filters.agentId === "support"
            ? [{ dimensions: { user, tool: "refund" }, total: 1, points: [] }]
            : [];
        return {
          id: `fixture-${metric}-groups`,
          query: { metric, dimensions: ["tool", "user"], from, to, filters },
          data: {
            metric,
            unit: "count",
            from,
            to,
            grain: null,
            total: series.length,
            asOf: "fixture_v1",
            truncated: false,
            coverage: {
              captureStartedAt: "2026-09-01T00:00:00.000Z",
              windowFullyCaptured: true,
            },
            series,
          },
        };
      }),
    };
  }
  if (
    "question" in body &&
    /response.?time.*distribution/i.test(String(body.question))
  ) {
    const query = { metric: "response_time_distribution", from, to, filters };
    return {
      version: 1,
      text: "Recorded runs by response time.",
      results: [
        {
          id: "fixture-duration-groups",
          query,
          data: intelligenceAnalyticsFixture({
            method: "POST",
            path: "/api/v1/metrics/query",
            body: query,
          }),
        },
      ],
    };
  }
  if (
    "question" in body &&
    /runs.*model.*outcome/i.test(String(body.question))
  ) {
    const series = [
      {
        agentId: "support",
        dimensions: { model: "customer-model", outcome: "success" },
      },
      {
        agentId: "billing",
        dimensions: { model: "customer-model", outcome: "error" },
      },
      { agentId: "support", dimensions: { model: null, outcome: "success" } },
    ]
      .filter((row) => !filters.agentId || row.agentId === filters.agentId)
      .map(({ dimensions }) => ({ dimensions, total: 1, points: [] }));
    return {
      version: 1,
      text: "Recorded runs by model and outcome.",
      results: [
        {
          id: "fixture-run-groups",
          query: {
            metric: "runs",
            dimensions: ["model", "outcome"],
            from,
            to,
            filters,
          },
          data: {
            metric: "runs",
            unit: "count",
            from,
            to,
            grain: null,
            total: series.length,
            asOf: "fixture_v1",
            truncated: false,
            coverage: {
              captureStartedAt: "2026-09-01T00:00:00.000Z",
              windowFullyCaptured: true,
            },
            series,
          },
        },
      ],
    };
  }
  return {
    version: 1,
    text: "Refund had the most errors (4).",
    results: [
      {
        id: "fixture-query-1",
        query: {
          metric: "tool_errors",
          dimensions: ["tool"],
          from,
          to,
          filters,
        },
        data: {
          metric: "tool_errors",
          unit: "count",
          from,
          to,
          grain: null,
          total: 6,
          asOf: "fixture_v1",
          truncated: false,
          coverage: {
            captureStartedAt: "2026-09-01T00:00:00.000Z",
            windowFullyCaptured: true,
          },
          series: [
            { dimensions: { tool: "refund" }, total: 4, points: [] },
            { dimensions: { tool: "lookup_order" }, total: 2, points: [] },
          ],
        },
      },
    ],
  };
}
