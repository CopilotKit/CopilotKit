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
