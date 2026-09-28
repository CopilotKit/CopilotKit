import { expect, test } from "vitest";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";

test.each(["runs", "tool_calls"])(
  "%s exports carry scoped rows and capture metadata without private content",
  (kind) => {
    const filters =
      kind === "runs"
        ? { agentId: "support", sort: "duration", asOf: "fixture_v1" }
        : {
            agentId: "support",
            toolName: "refund",
            outcome: "success",
            asOf: "fixture_v1",
          };
    const created = intelligenceExportFixture({
      method: "POST",
      path: "/api/v1/exports",
      body: {
        kind,
        format: "json",
        from: "2026-09-20T00:00:00.000Z",
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
      throw new Error("Missing job");
    const file = intelligenceExportFixture({
      method: "GET",
      path: `/api/v1/exports/${job.id}/content`,
    });
    if (typeof file?.body !== "string") throw new Error("Missing file");
    const decoded = JSON.parse(file.body);
    expect(decoded.metadata.filters).toEqual(filters);
    expect(decoded.data).toHaveLength(kind === "runs" ? 2 : 124);
    expect(
      decoded.data.every(
        (row: Record<string, unknown>) => row.agentId === "support",
      ),
    ).toBe(true);
    expect(
      decoded.data.every(
        (row: Record<string, unknown>) =>
          !("input" in row) && !("error" in row),
      ),
    ).toBe(true);
    if (kind === "runs")
      expect(
        decoded.data.map((row: Record<string, unknown>) => row.runId),
      ).toEqual(["fixture-run-1", "fixture-run-3"]);
    else
      expect(
        decoded.data.every(
          (row: Record<string, unknown>) =>
            row.toolName === "refund" && row.outcome === "success",
        ),
      ).toBe(true);
  },
);
