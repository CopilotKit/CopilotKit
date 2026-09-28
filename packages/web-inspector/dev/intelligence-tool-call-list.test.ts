import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";

const period = {
  from: "2026-09-20T00:00:00.000Z",
  to: "2026-09-27T00:00:00.000Z",
};

test("tool-call fixture filters errors and missing users without exposing call content", () => {
  const errors = intelligenceFixture({
    method: "GET",
    path: "/api/v1/tool-calls",
    query: { ...period, metric: "tool_errors" },
  });
  expect(errors.status).toBe(200);
  expect(errors.body).toMatchObject({
    data: Array.from({ length: 6 }, () =>
      expect.objectContaining({ outcome: "error" }),
    ),
  });
  expect(JSON.stringify(errors.body)).not.toContain("ORDER-1042");
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/tool-calls",
      query: { ...period, userCapture: "missing" },
    }).body,
  ).toMatchObject({
    data: [
      {
        toolCallId: "fixture-unnamed-call",
        toolName: null,
        outcome: "pending",
      },
    ],
  });
  expect(
    intelligenceFixture({
      method: "POST",
      path: "/ask",
      body: { ...period, question: "Tool calls by user" },
    }).body,
  ).toMatchObject({
    results: [
      {
        data: {
          total: 513,
          series: [
            { dimensions: { user: "customer-1" }, total: 512 },
            { dimensions: { user: null }, total: 1 },
          ],
        },
      },
    ],
  });
});

test("a missing-user tool-call export matches the fixture list", () => {
  const job = intelligenceExportFixture({
    method: "POST",
    path: "/api/v1/exports",
    body: {
      ...period,
      kind: "tool_calls",
      format: "json",
      filters: { metric: "tool_calls", userCapture: "missing" },
    },
  });
  if (!job || typeof job.body !== "object" || !job.body || !("id" in job.body))
    throw new Error("Missing job");
  const file = intelligenceExportFixture({
    method: "GET",
    path: `/api/v1/exports/${String(job.body.id)}/content`,
  });
  if (typeof file?.body !== "string") throw new Error("Missing export");
  expect(JSON.parse(file.body)).toMatchObject({
    metadata: { rowCount: 1 },
    data: [{ toolCallId: "fixture-unnamed-call" }],
  });
});
