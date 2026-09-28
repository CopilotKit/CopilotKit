import { expect, test } from "vitest";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";
import { intelligenceContentFixture } from "./intelligence-content-fixtures.js";

test.each(["json", "csv"])(
  "tool summary exports match the visible sorted list in %s",
  (format) => {
    const query = {
      from: "2026-09-20T00:00:00.000Z",
      to: "2026-09-27T00:00:00.000Z",
      agentId: "support",
      sort: "errors",
      asOf: "fixture_v1",
    };
    const shown = intelligenceContentFixture({
      method: "GET",
      path: "/api/v1/tools",
      query,
    });
    if (typeof shown !== "object" || shown === null || !("data" in shown))
      throw new Error("Missing list");
    const created = intelligenceExportFixture({
      method: "POST",
      path: "/api/v1/exports",
      body: {
        kind: "tools",
        format,
        from: query.from,
        to: query.to,
        filters: { agentId: query.agentId, sort: query.sort, asOf: query.asOf },
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
    if (typeof file?.body !== "string") throw new Error("Missing file");
    if (format === "json")
      expect(JSON.parse(file.body)).toMatchObject({
        data: shown.data,
        metadata: {
          kind: "tools",
          rowCount: 2,
          filters: { agentId: "support", sort: "errors", asOf: "fixture_v1" },
        },
      });
    else {
      expect(file.body.split("\r\n")[0]).toBe(
        "toolName,calls,errors,successRate,avgMs,medianMs,lastCalledAt",
      );
      expect(file.body.split("\r\n")[1]).toMatch(/^refund,128,4,/);
      expect(file.body.split("\r\n")[2]).toMatch(/^lookup_order,384,2,/);
    }
  },
);
