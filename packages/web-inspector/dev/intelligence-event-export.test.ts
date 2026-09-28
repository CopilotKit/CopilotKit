import { expect, test } from "vitest";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";
import { intelligenceAnalyticsFixture } from "./intelligence-analytics-fixtures.js";

test("event exports match selected event metadata and never copy content", () => {
  const from = new Date(Date.now() - 86400000).toISOString();
  const to = new Date().toISOString();
  for (const [agentId, count] of [
    ["support", 1],
    ["billing", 0],
  ] as const) {
    const created = intelligenceExportFixture({
      method: "POST",
      path: "/api/v1/exports",
      body: {
        kind: "events",
        format: "json",
        from,
        to,
        filters: { agentId, type: "message.recorded", order: "asc" },
      },
    });
    const job = created?.body;
    if (typeof job !== "object" || job === null || !("id" in job))
      throw new Error("Missing export");
    const file = intelligenceExportFixture({
      method: "GET",
      path: `/api/v1/exports/${String(job.id)}/content`,
    });
    if (typeof file?.body !== "string") throw new Error("Missing content");
    const exported = JSON.parse(file.body);
    expect(exported.metadata.rowCount).toBe(count);
    expect(exported.data).toHaveLength(count);
    if (count)
      expect(exported.data[0]).toMatchObject({
        id: "fixture-event-1",
        type: "message.recorded",
        agentId,
        contentAvailable: true,
      });
    expect(file.body).not.toContain('"content":');
    expect(file.body).not.toContain("duplicate charge");
  }
});

test("event fixtures filter scope and window and retain chronological order", () => {
  const from = new Date(Date.now() - 86400000).toISOString();
  const to = new Date().toISOString();
  expect(
    intelligenceAnalyticsFixture({
      method: "GET",
      path: "/api/v1/events",
      query: { agentId: "billing", from, to },
    }),
  ).toMatchObject({ data: [] });
  expect(
    intelligenceAnalyticsFixture({
      method: "GET",
      path: "/api/v1/events",
      query: {
        agentId: "support",
        from: "2020-01-01T00:00:00Z",
        to: "2020-01-02T00:00:00Z",
      },
    }),
  ).toMatchObject({ data: [] });
  expect(
    intelligenceAnalyticsFixture({
      method: "GET",
      path: "/api/v1/events",
      query: { agentId: "support", from, to, order: "asc" },
    }),
  ).toMatchObject({
    data: [
      { id: "fixture-event-2" },
      { id: "fixture-event-1" },
      { id: "fixture-event-0" },
    ],
  });
});
