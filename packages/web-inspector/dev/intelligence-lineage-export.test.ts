import { expect, test } from "vitest";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";

/** Creates and downloads a scoped local lineage export through the fixture routes. */
function setup(format: string, from = "2026-09-20T00:00:00.000Z", version = 3) {
  const filters = {
    skillId: "10000000-0000-4000-8000-000000000002",
    agentId: "billing",
    version,
  };
  const created = intelligenceExportFixture({
    method: "POST",
    path: "/api/v1/exports",
    body: {
      kind: "skill_lineage",
      format,
      from,
      to: "2026-09-27T00:00:00.000Z",
      filters,
    },
  });
  const job = created?.body;
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
  if (typeof file?.body !== "string")
    throw new Error("Missing fixture content");
  return { text: file.body, filters };
}

test.each(["json", "csv"])(
  "lineage exports retain scoped history and all selected loads in %s",
  (format) => {
    const result = setup(format);

    expect(result.text).toContain("invoice-reference");
    expect(result.text).not.toContain("refund-policy");
    expect(result.text.match(/fixture-run-2/g)).toHaveLength(5);
    if (format === "json") {
      const body = JSON.parse(result.text);
      expect(body.metadata).toMatchObject({
        kind: "skill_lineage",
        rowCount: 11,
        filters: result.filters,
      });
      expect(body.data.map((row: { section: string }) => row.section)).toEqual([
        "skill",
        "conversation",
        "insight",
        "review",
        "version",
        "registry",
        "load",
        "load",
        "load",
        "load",
        "load",
      ]);
    } else {
      expect(result.text.split("\n")[0]?.trim()).toBe(
        "section,skillId,version,record",
      );
      expect(result.text).toContain('""runId"":""fixture-run-2""');
    }
  },
);

test("lineage exports retain history when no load falls within the selected period", () => {
  const result = setup("json", "2026-09-26T23:30:00.000Z");

  expect(result.text).toContain("invoice-reference");
  expect(result.text).not.toContain("fixture-run-2");
  expect(JSON.parse(result.text).metadata.rowCount).toBe(6);
});

test("lineage export fixtures honor a selected version", () => {
  const result = setup("json", "2026-09-20T00:00:00.000Z", 2);

  expect(
    JSON.parse(result.text).data.map((row: { section: string }) => row.section),
  ).toEqual(["skill", "conversation", "insight", "review"]);
});
