import { expect, test } from "vitest";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";

test.each(["json", "csv"])(
  "run actions export fixtures contain the displayed action sections in %s",
  (format) => {
    const filters = {
      runId: "fixture-run-1",
      agentId: "support",
      asOf: "fixture_v1",
    };
    const job = intelligenceExportFixture({
      method: "POST",
      path: "/api/v1/exports",
      body: {
        kind: "run_actions",
        format,
        from: "2026-09-20T00:00:00.000Z",
        to: "2026-09-27T00:00:00.000Z",
        filters,
      },
    })?.body;
    if (
      typeof job !== "object" ||
      job === null ||
      !("id" in job) ||
      typeof job.id !== "string"
    )
      throw new Error("Missing fixture job");

    const file = intelligenceExportFixture({
      method: "GET",
      path: `/api/v1/exports/${job.id}/content`,
    });
    if (typeof file?.body !== "string") throw new Error("Missing fixture file");

    expect(file.body).toContain("refund-policy");
    expect(file.body).toContain("review_required");
    if (format === "json") {
      const body = JSON.parse(file.body);
      expect(body.metadata).toMatchObject({
        kind: "run_actions",
        rowCount: 4,
        filters,
      });
      expect(body.data.map((row: { section: string }) => row.section)).toEqual([
        "access_decision",
        "tool_call",
        "approval",
        "skill_load",
      ]);
    } else
      expect(file.body.split("\n")[0]?.trim()).toBe(
        "section,runId,occurredAt,record",
      );
  },
);
