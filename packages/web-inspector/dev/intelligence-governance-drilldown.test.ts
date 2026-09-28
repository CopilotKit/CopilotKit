import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";

test("the fixture distinguishes unresolved approvals and exports the same records", () => {
  const query = {
    from: "2026-09-20T00:00:00.000Z",
    to: "2026-09-27T00:00:00.000Z",
    agentId: "support",
    summary: "unansweredApprovals",
  };
  const response = intelligenceFixture({
    method: "GET",
    path: "/api/v1/governance/events",
    query,
  });
  expect(response.body).toMatchObject({
    data: [
      expect.objectContaining({ type: "approval.requested" }),
      expect.objectContaining({ type: "run.finished", outcome: "interrupted" }),
    ],
  });
  const job = intelligenceExportFixture({
    method: "POST",
    path: "/api/v1/exports",
    body: {
      kind: "activity",
      format: "json",
      from: query.from,
      to: query.to,
      filters: { agentId: query.agentId, summary: query.summary },
    },
  });
  if (
    !job ||
    typeof job.body !== "object" ||
    job.body === null ||
    !("id" in job.body)
  )
    throw new Error("Missing export");
  const download = intelligenceExportFixture({
    method: "GET",
    path: `/api/v1/exports/${String(job.body.id)}/content`,
  });
  if (typeof download?.body !== "string") throw new Error("Missing content");
  expect(JSON.parse(download.body)).toMatchObject({
    metadata: { rowCount: 2, filters: { summary: "unansweredApprovals" } },
    data: [
      expect.objectContaining({
        type: "approval.requested",
        actorType: "app_user",
        actorId: "reviewer-7",
        details: "{}",
      }),
      expect.objectContaining({ type: "run.finished" }),
    ],
  });
});

test("summary fixture counts match the selected agent's drilldown rows", () => {
  const query = { agentId: "support" };
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/governance/summary",
      query,
    }).body,
  ).toMatchObject({
    asOf: "fixture_v1",
    current: {
      counts: {
        runs: 1,
        approvals: 1,
        rejections: 1,
        unansweredApprovals: 2,
        skillChanges: 1,
      },
    },
  });
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/governance/events",
      query: { agentId: "billing", summary: "unansweredApprovals" },
    }).body,
  ).toEqual({ data: [], nextCursor: null, asOf: "fixture_v1" });
});

test("run accountability fixtures retain the cutoff and include recorded access decisions", () => {
  expect(
    intelligenceFixture({
      method: "GET",
      path: "/api/v1/governance/runs/fixture-run-1",
      query: { asOf: "fixture_v1" },
    }).body,
  ).toMatchObject({
    asOf: "fixture_v1",
    accessDecisions: [
      {
        type: "access.denied",
        details: { permission: "refund.issue", reason: "review_required" },
      },
    ],
  });
});
