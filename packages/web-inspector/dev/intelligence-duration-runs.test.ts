import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";

const period = {
  from: "2026-09-20T00:00:00.000Z",
  to: "2026-09-27T00:00:00.000Z",
};

test("response-time fixture counts and selected runs agree", () => {
  const metric = intelligenceFixture({
    method: "POST",
    path: "/api/v1/metrics/query",
    body: {
      metric: "response_time_distribution",
      ...period,
      filters: { agentId: "billing" },
    },
  });
  expect(metric.body).toMatchObject({
    total: 1,
    series: expect.arrayContaining([
      { dimensions: { responseTime: "<1s" }, total: 1, points: [] },
    ]),
  });
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/runs",
      query: { ...period, responseTimeBucket: "<1s" },
    }).body,
  ).toMatchObject({ data: [{ runId: "fixture-run-2", durationMs: 800 }] });
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/runs",
      query: { ...period, responseTimeBucket: "<1s", agentId: "support" },
    }).body,
  ).toMatchObject({ data: [] });
});

test("Ask and exported run fixtures keep response-time buckets", () => {
  expect(
    intelligenceFixture({
      method: "POST",
      path: "/ask",
      body: { question: "Response time distribution", ...period },
    }).body,
  ).toMatchObject({
    results: [{ data: { metric: "response_time_distribution", total: 3 } }],
  });
  const created = intelligenceExportFixture({
    method: "POST",
    path: "/api/v1/exports",
    body: {
      kind: "runs",
      format: "json",
      ...period,
      filters: { responseTimeBucket: "<1s" },
    },
  });
  const job = created?.body;
  if (
    typeof job !== "object" ||
    job === null ||
    !("id" in job) ||
    typeof job.id !== "string"
  )
    throw new Error("Missing job");
  const file = intelligenceExportFixture({
    method: "GET",
    path: `/api/v1/exports/${job.id}/content`,
  });
  if (typeof file?.body !== "string") throw new Error("Missing file");
  expect(JSON.parse(file.body)).toMatchObject({
    metadata: { rowCount: 1, filters: { responseTimeBucket: "<1s" } },
    data: [{ runId: "fixture-run-2" }],
  });
});
