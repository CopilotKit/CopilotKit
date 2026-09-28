import { intelligenceLearningFixture } from "./intelligence-learning-fixtures.js";
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
        id: "20000000-0000-4000-8000-000000000002",
        contributingConversations: 3,
        statement:
          "Include the invoice reference when answering billing questions",
      },
    ],
  });
  expect(file.body).not.toContain("20000000-0000-4000-8000-000000000001");
});

test.each(["json", "csv"])(
  "Skill export fixtures match the scoped list in %s",
  (format) => {
    const created = intelligenceExportFixture({
      method: "POST",
      path: "/api/v1/exports",
      body: {
        kind: "skills",
        format,
        from: "2026-09-20T00:00:00.000Z",
        to: "2026-09-27T00:00:00.000Z",
        filters: {
          agentId: "billing",
          containerId: "billing",
          asOf: "loadedCapture",
        },
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
    if (typeof file?.body !== "string") throw new Error("Missing content");
    expect(file.body).toContain("invoice-reference");
    expect(file.body).not.toContain("refund-policy");
    if (format === "json")
      expect(JSON.parse(file.body)).toMatchObject({
        data: [{ loads: { count: 5, runCount: 1 } }],
        metadata: {
          rowCount: 1,
          filters: {
            agentId: "billing",
            containerId: "billing",
            asOf: "loadedCapture",
          },
        },
      });
    else {
      expect(file.body).toContain("runsLoaded");
      expect(file.body).toContain("deliveryEnabled");
    }
  },
);

test("Learning fixtures intersect the selected container and agent", () => {
  expect(
    intelligenceLearningFixture({
      method: "GET",
      path: "/api/v1/learning/skills",
      query: { agentId: "billing", containerId: "support" },
    }),
  ).toMatchObject({ data: [] });
});

test("Skill usage and lineage agree on distinct runs and the selected load window", () => {
  const query = {
    agentId: "billing",
    from: "2026-09-20T00:00:00.000Z",
    to: "2026-09-27T00:00:00.000Z",
  };
  const lineage = intelligenceLearningFixture({
    method: "GET",
    path: "/api/v1/learning/skills/10000000-0000-4000-8000-000000000002/lineage",
    query,
  });

  expect(lineage).toMatchObject({
    loadsWindow: { from: query.from, to: query.to },
    versions: [
      {
        loads: {
          data: Array.from({ length: 5 }, () => ({ runId: "fixture-run-2" })),
        },
      },
    ],
  });
  expect(
    intelligenceLearningFixture({
      method: "GET",
      path: "/api/v1/learning/skills",
      query,
    }),
  ).toMatchObject({ data: [{ loads: { count: 5, runCount: 1 } }] });
  expect(
    intelligenceLearningFixture({
      method: "GET",
      path: "/api/v1/learning/skills/10000000-0000-4000-8000-000000000002/lineage",
      query: { ...query, from: "2026-09-26T23:30:00.000Z" },
    }),
  ).toMatchObject({ versions: [{ loads: { data: [] } }] });
});

test("Skill list fixtures return a capture cutoff and preserve a requested cutoff", () => {
  for (const asOf of [undefined, "requestedCapture"]) {
    const response = intelligenceLearningFixture({
      method: "GET",
      path: "/api/v1/learning/skills",
      query: asOf ? { asOf } : {},
    });
    expect(response).toMatchObject({ asOf: asOf ?? expect.any(String) });
  }
});

test("Skill run fixtures and exports share the selected Skill, agent and cutoff", () => {
  const skillId = "10000000-0000-4000-8000-000000000002";
  const query = {
    agentId: "billing",
    asOf: "loadedCapture",
    from: "2026-09-20T00:00:00.000Z",
    to: "2026-09-27T00:00:00.000Z",
  };
  const response = intelligenceLearningFixture({
    method: "GET",
    path: `/api/v1/learning/skills/${skillId}/runs`,
    query,
  });
  expect(response).toMatchObject({
    skill: { id: skillId },
    asOf: query.asOf,
    runCount: 1,
    unidentifiedLoads: 0,
    data: [{ runId: "fixture-run-2", agentId: "billing", loadCount: 5 }],
  });
  for (const format of ["json", "csv"]) {
    const created = intelligenceExportFixture({
      method: "POST",
      path: "/api/v1/exports",
      body: {
        kind: "skill_runs",
        format,
        from: query.from,
        to: query.to,
        filters: { skillId, agentId: query.agentId, asOf: query.asOf },
      },
    });
    const job = created?.body;
    if (typeof job !== "object" || job === null || !("id" in job))
      throw new Error("Missing job");
    const file = intelligenceExportFixture({
      method: "GET",
      path: `/api/v1/exports/${job.id}/content`,
    });
    if (typeof file?.body !== "string") throw new Error("Missing content");
    expect(file.body).toContain("fixture-run-2");
    expect(file.body).not.toContain("fixture-run-1");
    if (format === "json")
      expect(JSON.parse(file.body)).toMatchObject({
        metadata: { filters: { skillId, asOf: query.asOf } },
        data: [{ loadCount: 5 }],
      });
    else
      expect(file.body.split("\r\n")[0]).toBe(
        "runId,threadId,agentId,loadCount,firstLoadedAt,lastLoadedAt",
      );
  }
});

test("Insight evidence fixtures page and export all contributing identifiers", () => {
  const insightId = "20000000-0000-4000-8000-000000000001";
  const query = {
    from: "2026-09-20T00:00:00.000Z",
    to: "2026-09-27T00:00:00.000Z",
    agentId: "support",
  };
  const path = `/api/v1/learning/insights/${insightId}/conversations`;
  const first = intelligenceLearningFixture({ method: "GET", path, query });
  expect(first).toMatchObject({
    total: 8,
    data: [
      { threadId: "fixture-thread-1" },
      { threadId: "fixture-thread-1-2" },
    ],
    nextCursor: "fixtureEvidence2",
  });
  const second = intelligenceLearningFixture({
    method: "GET",
    path,
    query: { ...query, cursor: "fixtureEvidence2" },
  });
  expect(second).toMatchObject({
    total: 8,
    data: [
      { threadId: "fixture-thread-1-3" },
      { threadId: "fixture-thread-1-4" },
    ],
  });
  for (const format of ["json", "csv"]) {
    const created = intelligenceExportFixture({
      method: "POST",
      path: "/api/v1/exports",
      body: {
        kind: "insight_conversations",
        format,
        from: query.from,
        to: query.to,
        filters: { insightId, agentId: "support" },
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
    if (typeof file?.body !== "string") throw new Error("Missing content");
    expect(file.body).toContain("fixture-thread-1-8");
    expect(file.body).not.toContain("fixture-thread-2");
    if (format === "json")
      expect(JSON.parse(file.body)).toMatchObject({
        metadata: { rowCount: 8 },
        data: Array.from({ length: 8 }, (_, index) => ({
          threadId: index
            ? `fixture-thread-1-${index + 1}`
            : "fixture-thread-1",
        })),
      });
  }
});
