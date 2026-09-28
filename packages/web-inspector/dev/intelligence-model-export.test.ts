import { expect, test } from "vitest";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";

test("model usage exports contain the table values and preceding period", () => {
  const created = intelligenceExportFixture({
    method: "POST",
    path: "/api/v1/exports",
    body: {
      kind: "model_usage",
      format: "json",
      from: "2026-09-20T00:00:00.000Z",
      to: "2026-09-27T00:00:00.000Z",
      filters: { agentId: "support", asOf: "fixture_v1" },
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
  const result = JSON.parse(file.body);

  expect(result.metadata).toMatchObject({
    rowCount: 2,
    filters: { agentId: "support", asOf: "fixture_v1" },
  });
  expect(result.data[0]).toMatchObject({
    model: "customer-model",
    runs: 7463,
    avgResponseMs: 2400,
    previousAvgResponseMs: 1920,
    previousWindowFullyCaptured: true,
  });
  expect(result.data[0].previousRuns).toBeCloseTo(5970.4);
  expect(result.data[1].model).toBe("customer-model-fast");
});
