import { intelligenceAskFixture } from "./intelligence-ask-fixture.js";
import { intelligenceAnalyticsFixture } from "./intelligence-analytics-fixtures.js";
import { intelligenceLearningFixture } from "./intelligence-learning-fixtures.js";
import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";
import { intelligenceContentFixture } from "./intelligence-content-fixtures.js";

/** Supplies explicit fixture data for the local embedded Inspector workbench. */
export function intelligenceFixture(request: IntelligenceReadRequest): {
  status: number;
  body: unknown;
} {
  const ok = (body: unknown) => ({ status: 200, body });
  const content =
    intelligenceAskFixture(request) ??
    intelligenceAnalyticsFixture(request) ??
    intelligenceLearningFixture(request) ??
    intelligenceContentFixture(request);
  if (content !== undefined) return ok(content);
  const to = request.query?.to ?? new Date().toISOString();
  const from =
    request.query?.from ??
    new Date(Date.parse(to) - 7 * 86400000).toISOString();
  const at = new Date(Date.parse(to) - 3600000).toISOString();
  if (request.path === "/context")
    return ok({
      version: 1,
      grant: {
        permissions: Object.fromEntries(
          [
            "analytics.numbers",
            "analytics.topics",
            "learning.insights_skills",
            "governance.record",
            "conversations.text",
          ].map((permission) => [permission, { agents: "*" }]),
        ),
      },
      agents: ["support", "billing"],
      askAvailable: true,
    });
  if (request.path === "/api/v1/metrics/query" && isRecord(request.body)) {
    const metric = String(request.body.metric);
    const start = String(request.body.from);
    const end = String(request.body.to);
    const totals: Record<string, number> = {
      runs: 12438,
      active_users: 348,
      conversations: 921,
      tokens_in: 143820,
      tokens_out: 45630,
      avg_response_ms: 2100,
      failed_runs: 24,
    };
    const total = totals[metric] ?? 0;
    return ok({
      metric,
      unit: metric.includes("tokens")
        ? "tokens"
        : metric === "avg_response_ms"
          ? "milliseconds"
          : "count",
      grain: request.body.grain === "hour" ? "hour" : "day",
      from: start,
      to: end,
      total,
      series: [
        {
          dimensions: {},
          points: [1200, 1500, 1240, 1800, 1430, 1950, 2300].map(
            (value, index) => ({
              t: new Date(
                Date.parse(start) +
                  (index * (Date.parse(end) - Date.parse(start))) / 7,
              ).toISOString(),
              value:
                metric === "avg_response_ms"
                  ? total
                  : index === 6
                    ? total -
                      [1200, 1500, 1240, 1800, 1430, 1950].reduce(
                        (sum, weight) =>
                          sum + Math.round((total * weight) / 11420),
                        0,
                      )
                    : Math.round((total * value) / 11420),
            }),
          ),
          total,
        },
      ],
      truncated: false,
      coverage: {
        captureStartedAt: "2026-09-01T00:00:00.000Z",
        windowFullyCaptured: true,
      },
      asOf: "fixture_v1",
      comparison: {
        from: new Date(Date.parse(start) * 2 - Date.parse(end)).toISOString(),
        to: start,
        total: total * 0.8,
        series: [],
      },
    });
  }
  const runs = ["support", "billing", "support"].map((agentId, index) => ({
    runId: `fixture-run-${index + 1}`,
    threadId: `fixture-thread-${index + 1}`,
    agentId,
    userId: `customer-${index + 1}`,
    startedAt: at,
    endedAt: new Date(Date.parse(at) + 2100).toISOString(),
    outcome: index === 1 ? "error" : "success",
    durationMs: 2100,
    tokensIn: 720,
    tokensOut: 120,
    tokensTotal: 840,
    model: "customer-model",
    toolCalls: 1,
  }));
  if (request.path === "/api/v1/runs")
    return ok({
      data: runs.filter(
        (run) =>
          (!request.query?.outcome || run.outcome === request.query.outcome) &&
          (!request.query?.agentId || run.agentId === request.query.agentId),
      ),
      nextCursor: null,
      from,
      to,
      asOf: "fixture_v1",
    });
  const events = [
    {
      family: "approval",
      type: "approval.approved",
      outcome: "approved",
      details: { verified: true, mechanism: "interrupt" },
    },
    {
      family: "approval",
      type: "approval.responded",
      outcome: "answered",
      details: { verified: false, mechanism: "tool_response" },
    },
    {
      family: "access_decision",
      type: "access.denied",
      outcome: "denied",
      details: {
        permission: "conversations.text",
        reason: "Missing permission",
      },
    },
    {
      family: "deletion",
      type: "deletion.thread",
      outcome: "deleted",
      details: { resourceType: "conversation", count: 1 },
    },
  ].map((event, index) => ({
    ...event,
    id: `fixture-event-${index + 1}`,
    occurredAt: at,
    receivedAt: at,
    actor: { type: "app_user", id: `reviewer-${index + 1}` },
    agentId: "support",
    threadId: "fixture-thread-1",
    runId: "fixture-run-1",
    toolCallId: "fixture-tool-1",
    toolName: "refund",
    source: "runtime",
    captureVersion: 1,
  }));
  const families: Record<string, string> = {
    approvals: "approval",
    access: "access_decision",
    deletions: "deletion",
  };
  const leaf = request.path.split("/").at(-1) ?? "";
  if (
    request.path.startsWith("/api/v1/governance/") &&
    ["events", "approvals", "access", "deletions"].includes(leaf)
  )
    return ok({
      data: events.filter(
        (event) =>
          (!families[leaf] || event.family === families[leaf]) &&
          (!request.query?.agentId ||
            event.agentId === request.query.agentId) &&
          (!request.query?.outcome ||
            event.outcome === request.query.outcome) &&
          (!request.query?.actorId ||
            event.actor.id === request.query.actorId) &&
          (!request.query?.type || event.type === request.query.type),
      ),
      nextCursor: null,
    });
  if (request.path === "/api/v1/governance/summary") {
    const counts = {
      runs: 12438,
      approvals: 128,
      rejections: 8,
      approvalResponses: 6,
      cancellations: 2,
      unverifiedAnswers: 1,
      unansweredApprovals: 3,
      accessDenials: 4,
      skillChanges: 6,
      deletions: 3,
    };
    return ok({
      captureStartedAt: "2026-09-01T00:00:00.000Z",
      current: { from, to, coverage: "full", counts },
      previous: {
        from: new Date(Date.parse(from) * 2 - Date.parse(to)).toISOString(),
        to: from,
        coverage: "full",
        counts: Object.fromEntries(
          Object.entries(counts).map(([key, count]) => [
            key,
            Math.round(count * 0.8),
          ]),
        ),
      },
    });
  }
  if (request.path.startsWith("/api/v1/governance/runs/"))
    return ok({
      runId: leaf,
      threadId: "fixture-thread-1",
      agentId: "support",
      requester: { type: "app_user", id: "customer-1" },
      startedAt: at,
      endedAt: new Date(Date.parse(at) + 2100).toISOString(),
      outcome: "success",
      durationMs: 2100,
      tokens: { input: 720, output: 120, total: 840 },
      model: "customer-model",
      provider: "customer-provider",
      imported: false,
      channel: {
        kind: "web",
        provider: null,
        channelId: null,
        channelName: null,
      },
      toolCalls: [
        {
          toolCallId: "fixture-tool-1",
          toolName: "refund",
          outcome: "success",
          startedAt: at,
          completedAt: new Date(Date.parse(at) + 800).toISOString(),
          durationMs: 800,
        },
      ],
      approvals: [
        {
          id: "fixture-approval-1",
          type: "approval.approved",
          outcome: "approved",
          toolCallId: "fixture-tool-1",
          toolName: "refund",
          actor: { type: "app_user", id: "reviewer-1" },
          occurredAt: at,
          runId: leaf,
          mechanism: "interrupt",
          verified: true,
        },
      ],
      skillLoads: [
        {
          id: "fixture-skill-load-1",
          toolCallId: null,
          skillName: "refund-policy",
          revision: "v3",
          containerId: "support",
          outcome: "loaded",
          occurredAt: at,
        },
      ],
      conversation: { threadId: "fixture-thread-1" },
      notCaptured: [],
    });
  return { status: 404, body: null };
}

/** Narrows fixture request payloads without accepting executable input. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
