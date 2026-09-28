import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";
const period = {
  from: "2026-09-20T00:00:00.000Z",
  to: "2026-09-27T00:00:00.000Z",
};

test.each(["active_users", "conversations"])(
  "%s fixture totals agree with its distinct run IDs",
  (metric) => {
    expect(
      intelligenceFixture({
        method: "POST",
        path: "/api/v1/metrics/query",
        body: { ...period, metric, filters: { agentId: "support" } },
      }).body,
    ).toMatchObject({ total: 2 });
  },
);

test("Ask distinct-identity counts match the selected agent's runs", () => {
  expect(
    intelligenceFixture({
      method: "POST",
      path: "/ask",
      body: {
        ...period,
        agentId: "billing",
        question: "Active users and conversations",
      },
    }).body,
  ).toMatchObject({
    results: [
      { data: { metric: "active_users", total: 1 } },
      { data: { metric: "conversations", total: 1 } },
    ],
  });
});
