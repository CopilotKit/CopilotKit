import { expect, test } from "vitest";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";

test("Insight export fixtures use the same selected-agent records as the Learning views", () => {
  const created = intelligenceExportFixture({
    method: "POST",
    path: "/api/v1/exports",
    body: {
      kind: "insights",
      format: "json",
      from: "2026-09-20T00:00:00.000Z",
      to: "2026-09-27T00:00:00.000Z",
      filters: { agentId: "billing" },
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
  expect(JSON.parse(file.body)).toMatchObject({
    metadata: {
      kind: "insights",
      rowCount: 1,
      filters: { agentId: "billing" },
    },
    data: [
      {
        id: "insight-2",
        contributingConversations: 3,
        statement:
          "Include the invoice reference when answering billing questions",
      },
    ],
  });
  expect(file.body).not.toContain("insight-1");
});
