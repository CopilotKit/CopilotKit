import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";

/** Provides synthetic tool and replay responses for the local workbench. */
export function intelligenceContentFixture(
  request: IntelligenceReadRequest,
): unknown | undefined {
  const to = request.query?.to ?? new Date().toISOString();
  const from =
    request.query?.from ??
    new Date(Date.parse(to) - 7 * 86400000).toISOString();
  const at = new Date(Date.parse(to) - 3600000).toISOString();
  const tools = [
    {
      toolName: "refund",
      calls: 128,
      errors: 4,
      successRate: 124 / 128,
      avgMs: 320,
      medianMs: 240,
      lastCalledAt: at,
    },
    {
      toolName: "lookup_order",
      calls: 384,
      errors: 2,
      successRate: 382 / 384,
      avgMs: 180,
      medianMs: 140,
      lastCalledAt: at,
    },
  ];
  if (request.path === "/api/v1/tools") {
    const sort = request.query?.sort ?? "calls";
    const ordered = [...tools].sort((left, right) =>
      sort === "errors"
        ? right.errors - left.errors
        : sort === "avgMs"
          ? right.avgMs - left.avgMs
          : right.calls - left.calls,
    );
    const limit = Math.max(
      1,
      Math.min(500, Number(request.query?.limit ?? "500") || 500),
    );
    const offset = request.query?.cursor === `fixture_tools_${sort}_1` ? 1 : 0;
    const next = offset + limit;
    const captureStartedAt = "2026-09-01T00:00:00.000Z";
    const previousFrom = new Date(
      Date.parse(from) * 2 - Date.parse(to),
    ).toISOString();
    return {
      data: ordered.slice(offset, next),
      totals: {
        tools: tools.length,
        calls: tools.reduce((sum, tool) => sum + tool.calls, 0),
        errors: tools.reduce((sum, tool) => sum + tool.errors, 0),
      },
      coverage: {
        captureStartedAt,
        windowFullyCaptured: Date.parse(from) >= Date.parse(captureStartedAt),
      },
      comparison: {
        from: previousFrom,
        to: from,
        totals: { tools: 2, calls: 256, errors: 3 },
        coverage: {
          captureStartedAt,
          windowFullyCaptured:
            Date.parse(previousFrom) >= Date.parse(captureStartedAt),
        },
      },
      nextCursor: next < tools.length ? `fixture_tools_${sort}_${next}` : null,
      from,
      to,
      asOf: "fixture_v1",
    };
  }
  if (request.path.startsWith("/api/v1/tools/")) {
    const name = decodeURIComponent(request.path.split("/").at(-1) ?? "refund");
    const fallback = tools[0];
    if (!fallback) return undefined;
    const tool = tools.find((item) => item.toolName === name) ?? fallback;
    const { toolName, lastCalledAt: _lastCalledAt, ...tiles } = tool;
    const outcome = request.query?.outcome;
    const calls = Array.from({ length: tiles.calls }, (_, index) => {
      const failed = index > 0 && index <= tiles.errors;
      return {
        time: new Date(
          Date.parse(to) -
            ((index + 1) * (Date.parse(to) - Date.parse(from))) /
              (tiles.calls + 1),
        ).toISOString(),
        toolCallId: `fixture-tool-${index + 1}`,
        toolName,
        runId: "fixture-run-1",
        threadId: "fixture-thread-1",
        agentId: request.query?.agentId ?? "support",
        outcome: failed ? "error" : "success",
        durationMs: 240,
        input: '{"orderId":"ORDER-1042","reason":"duplicate_charge"}',
        error: failed ? "Refund provider unavailable" : null,
      };
    }).filter((call) => !outcome || call.outcome === outcome);
    const prefix = `fixture_calls_${outcome ?? "all"}_`;
    const offset = request.query?.cursor?.startsWith(prefix)
      ? Number(request.query.cursor.slice(prefix.length)) || 0
      : 0;
    const limit = Math.max(
      1,
      Math.min(100, Number(request.query?.limit ?? "50") || 50),
    );
    return {
      toolName,
      grain: request.query?.grain === "hour" ? "hour" : "day",
      from,
      to,
      asOf: "fixture_v1",
      tiles,
      series: {
        calls: [14, 18, 22, 16, 21, 18, 19].map((value, index) => ({
          t: new Date(
            Date.parse(from) +
              (index * (Date.parse(to) - Date.parse(from))) / 7,
          ).toISOString(),
          value,
        })),
        errors: [],
      },
      topArguments: {
        sampledCalls: 128,
        values: [
          { key: "reason", value: "duplicate_charge", count: 18 },
          { key: "reason", value: "returned_item", count: 42 },
        ],
      },
      recentCalls: {
        data: calls.slice(offset, offset + limit),
        nextCursor:
          offset + limit < calls.length ? `${prefix}${offset + limit}` : null,
      },
    };
  }
  const conversations = [
    {
      threadId: "fixture-thread-1",
      agentId: "support",
      userId: "customer-1",
      startedAt: at,
      lastActiveAt: new Date(Date.parse(at) + 60000).toISOString(),
      models: ["customer-model"],
      failed: false,
      deleted: false,
      deletedAt: null,
      runs: 2,
      messages: 3,
      toolCalls: 1,
      tokensIn: 720,
      tokensOut: 120,
      durationMs: 2100,
    },
    {
      threadId: "fixture-thread-2",
      agentId: "billing",
      userId: "customer-2",
      startedAt: at,
      lastActiveAt: at,
      models: ["customer-model"],
      failed: true,
      deleted: false,
      deletedAt: null,
      runs: 1,
      messages: 2,
      toolCalls: 1,
      tokensIn: 600,
      tokensOut: 80,
      durationMs: 1800,
    },
  ];
  if (request.path === "/api/v1/conversations")
    return {
      data: conversations.filter(
        (item) =>
          (!request.query?.agentId || request.query.agentId === item.agentId) &&
          (!request.query?.userId || request.query.userId === item.userId) &&
          (!request.query?.failed ||
            String(item.failed) === request.query.failed),
      ),
      nextCursor: null,
    };
  if (
    request.path.startsWith("/api/v1/conversations/") &&
    request.path.endsWith("/replay")
  )
    return {
      threadId: request.path.split("/")[4],
      agentId: "support",
      userId: "customer-1",
      tiles: {
        messages: 3,
        toolCalls: 1,
        tokensIn: 720,
        tokensOut: 120,
        durationMs: 2100,
      },
      runs: [
        {
          runId: "fixture-run-1",
          startedAt: at,
          outcome: "interrupted",
          durationMs: 1600,
          tokensIn: 600,
          tokensOut: 80,
          model: "customer-model",
          steps: [
            {
              index: 0,
              name: "Review refund",
              entries: [
                {
                  id: "fixture-user-1",
                  kind: "user_message",
                  at,
                  messageId: "message-1",
                  text: "I was charged twice for order ORDER-1042. Can you check?",
                },
                {
                  id: "fixture-reason-1",
                  kind: "reasoning",
                  at,
                  messageId: null,
                  text: "Check the order and apply the approved refund policy.",
                },
                {
                  id: "fixture-skill-1",
                  kind: "skill_load",
                  at,
                  toolCallId: null,
                  skillName: "refund-policy",
                  revision: "v3",
                  containerId: "support",
                },
                {
                  id: "fixture-tool-1",
                  kind: "tool_call",
                  at,
                  toolCallId: "tool-1",
                  toolName: "refund",
                  arguments:
                    '{"orderId":"ORDER-1042","reason":"duplicate_charge"}',
                  result: null,
                  outcome: "pending",
                  durationMs: null,
                },
                {
                  id: "fixture-approval-1",
                  kind: "approval",
                  at,
                  toolCallId: "tool-1",
                  toolName: "refund",
                  outcome: "requested",
                  verified: null,
                  actor: { type: "agent", id: "support" },
                },
              ],
            },
          ],
        },
        {
          runId: "fixture-run-2",
          startedAt: new Date(Date.parse(at) + 60000).toISOString(),
          outcome: "success",
          durationMs: 500,
          tokensIn: 120,
          tokensOut: 40,
          model: "customer-model",
          steps: [
            {
              index: 0,
              name: "Confirm refund",
              entries: [
                {
                  id: "fixture-approval-2",
                  kind: "approval",
                  at,
                  toolCallId: "tool-1",
                  toolName: "refund",
                  outcome: "approved",
                  verified: true,
                  actor: { type: "app_user", id: "reviewer-1" },
                },
                {
                  id: "fixture-result-1",
                  kind: "tool_result",
                  at,
                  toolCallId: "tool-1",
                  toolName: "refund",
                  result: '{"status":"refunded"}',
                  outcome: "success",
                },
                {
                  id: "fixture-assistant-1",
                  kind: "assistant_message",
                  at,
                  messageId: "message-2",
                  text: "The duplicate charge is refunded. Your original order is unchanged.",
                },
              ],
            },
          ],
        },
      ],
      nextCursor: null,
    };
  return undefined;
}
