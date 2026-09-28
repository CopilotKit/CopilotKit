import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";

const period = {
  from: "2026-09-20T00:00:00.000Z",
  to: "2026-09-27T00:00:00.000Z",
};

test("finished-run fixture excludes errors and preserves intersecting outcome filters", () => {
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/runs",
      query: { ...period, outcomeGroup: "finished" },
    }).body,
  ).toMatchObject({
    data: [{ runId: "fixture-run-1" }, { runId: "fixture-run-3" }],
  });
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/runs",
      query: { ...period, outcomeGroup: "finished", outcome: "error" },
    }).body,
  ).toMatchObject({ data: [] });
});

test("Ask fixture reports finished count and failure denominator for the selected agent", () => {
  expect(
    intelligenceFixture({
      method: "POST",
      path: "/ask",
      body: {
        ...period,
        question: "Finished runs and failure rate",
        agentId: "billing",
      },
    }).body,
  ).toMatchObject({
    results: [
      { data: { metric: "finished_runs", total: 0 } },
      { data: { metric: "failure_rate", total: 1 } },
    ],
  });
});
