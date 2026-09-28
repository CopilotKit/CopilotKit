import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";

const period = {
  from: "2026-09-20T00:00:00.000Z",
  to: "2026-09-27T00:00:00.000Z",
};

test("Ask approval fixtures use the same verified records as the list", () => {
  expect(
    intelligenceFixture({
      method: "POST",
      path: "/ask",
      body: {
        question: "Approvals and rejections by user",
        ...period,
        agentId: "support",
      },
    }).body,
  ).toMatchObject({
    results: [
      {
        data: {
          metric: "approvals",
          total: 1,
          series: [
            { dimensions: { user: "reviewer-1", tool: "refund" }, total: 1 },
          ],
        },
      },
      {
        data: {
          metric: "rejections",
          total: 1,
          series: [
            { dimensions: { user: "reviewer-6", tool: "refund" }, total: 1 },
          ],
        },
      },
    ],
  });
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/governance/events",
      query: { ...period, summary: "approvals", userId: "reviewer-6" },
    }).body,
  ).toMatchObject({ data: [] });
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/governance/events",
      query: { ...period, summary: "rejections", userId: "reviewer-6" },
    }).body,
  ).toMatchObject({ data: [{ type: "approval.rejected" }] });
});

test("missing-group fixture filters do not widen into known records", () => {
  for (const field of ["agentCapture", "userCapture", "toolCapture"]) {
    expect(
      intelligenceFixture({
        method: "GET",
        path: "/api/v1/governance/events",
        query: { ...period, [field]: "missing" },
      }).body,
    ).toMatchObject({ data: [] });
  }
});
