import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";

test("advertises fixture grants without credentials or console session data", () => {
  const response = intelligenceFixture({ method: "GET", path: "/context" });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    version: 1,
    agents: ["support", "billing"],
    askAvailable: true,
  });
  expect(JSON.stringify(response.body)).not.toMatch(
    /apiKey|Authorization|sessionToken/,
  );
});

test("serves governance records that distinguish an unverified approval answer", () => {
  const response = intelligenceFixture({
    method: "GET",
    path: "/api/v1/governance/approvals",
  });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    data: expect.arrayContaining([
      expect.objectContaining({
        family: "approval",
        details: expect.objectContaining({ verified: false }),
      }),
    ]),
    nextCursor: null,
  });
});

test("Ask fixture returns metric data for the requested period", () => {
  const response = intelligenceFixture({
    method: "POST",
    path: "/ask",
    body: {
      question: "Which tools failed most?",
      from: "2026-09-20T00:00:00.000Z",
      to: "2026-09-27T00:00:00.000Z",
      agentId: "support",
    },
  });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    version: 1,
    results: [
      {
        query: { filters: { agentId: "support" } },
        data: {
          metric: "tool_errors",
          from: "2026-09-20T00:00:00.000Z",
          to: "2026-09-27T00:00:00.000Z",
          total: 6,
        },
      },
    ],
  });
});

test("tool detail fixture limits recent calls to the requested outcome", () => {
  for (const [outcome, count] of [
    ["error", 4],
    ["success", 50],
    ["pending", 0],
  ] as const) {
    const response = intelligenceFixture({
      method: "GET",
      path: "/api/v1/tools/refund",
      query: { outcome },
    });
    expect(response.body).toMatchObject({
      tiles: { calls: 128, errors: 4 },
      recentCalls: {
        data: Array.from({ length: count }, () =>
          expect.objectContaining({ outcome }),
        ),
      },
    });
  }
});

test("Topics fixture changes counts and conversation links with the selected agent", () => {
  const response = intelligenceFixture({
    method: "GET",
    path: "/api/v1/learning/topics",
    query: { agentId: "billing" },
  });
  expect(response.body).toMatchObject({
    threadsAnalyzed: 1,
    topics: [
      {
        label: "Billing questions",
        threadCount: 1,
        threadIds: ["fixture-thread-2"],
      },
    ],
  });
});

test("Topics fixture describes an equal previous window only when requested", () => {
  const query = {
    from: "2026-09-20T00:00:00.000Z",
    to: "2026-09-27T00:00:00.000Z",
    compare: "previous_period",
  };
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/learning/topics",
      query,
    }).body,
  ).toMatchObject({
    comparison: {
      from: "2026-09-13T00:00:00.000Z",
      to: query.from,
      threadsAnalyzed: 0,
    },
  });
  expect(
    intelligenceFixture({ method: "GET", path: "/api/v1/learning/topics" })
      .body,
  ).not.toHaveProperty("comparison");
});

test("Learning fixtures follow the selected agent across lists and lineage", () => {
  const query = { agentId: "billing" };
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/learning/insights",
      query,
    }).body,
  ).toMatchObject({
    data: [{ id: "insight-2", contributingConversations: 3 }],
  });
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/learning/skills",
      query,
    }).body,
  ).toMatchObject({
    data: [
      { id: "10000000-0000-4000-8000-000000000002", name: "invoice-reference" },
    ],
  });
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/learning/skills/10000000-0000-4000-8000-000000000002/lineage",
      query,
    }).body,
  ).toMatchObject({
    contributingConversations: [
      { threadId: "fixture-thread-2", insightIds: ["insight-2"] },
    ],
  });
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/learning/skills/10000000-0000-4000-8000-000000000001/lineage",
      query,
    }).status,
  ).toBe(404);
});
