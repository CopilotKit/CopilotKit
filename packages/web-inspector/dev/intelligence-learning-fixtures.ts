import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";

/** Provides recorded Learning examples only in the local state lab. */
export function intelligenceLearningFixture(
  request: IntelligenceReadRequest,
): unknown {
  const to = request.query?.to ?? new Date().toISOString();
  const from =
    request.query?.from ??
    new Date(Date.parse(to) - 7 * 86400000).toISOString();
  const at = new Date(Date.parse(to) - 3600000).toISOString();
  const actor = { type: "operator", id: "alex@example.test" };
  const records = [
    {
      agentId: "support",
      id: "10000000-0000-4000-8000-000000000001",
      insightId: "insight-1",
      name: "refund-policy",
      statement: "Check for duplicate charges before issuing a refund",
      impact: "Avoid repeat refunds for the same order",
      topic: "Refunds",
      count: 8,
      loads: 12,
      threadId: "fixture-thread-1",
      runId: "fixture-run-1",
    },
    {
      agentId: "billing",
      id: "10000000-0000-4000-8000-000000000002",
      insightId: "insight-2",
      name: "invoice-reference",
      statement:
        "Include the invoice reference when answering billing questions",
      impact: "Reduce follow-up questions about invoices",
      topic: "Billing questions",
      count: 3,
      loads: 5,
      threadId: "fixture-thread-2",
      runId: "fixture-run-2",
    },
  ].filter(
    (record) =>
      (!request.query?.agentId || request.query.agentId === record.agentId) &&
      (!request.query?.containerId ||
        request.query.containerId === record.agentId),
  );
  const insightOf = (record: (typeof records)[number]) => ({
    id: record.insightId,
    statement: record.statement,
    impact: record.impact,
    createdAt: at,
    learningRunId: "learning-run-1",
    status: "active",
  });
  const loadsOf = (record: (typeof records)[number]) =>
    Array.from({ length: record.loads }, () => ({
      runId: record.runId,
      threadId: record.threadId,
      agentId: record.agentId,
      occurredAt: at,
    })).filter(
      (load) =>
        (!request.query?.from ||
          Date.parse(load.occurredAt) >= Date.parse(from)) &&
        (!request.query?.to || Date.parse(load.occurredAt) < Date.parse(to)),
    );
  if (request.path === "/api/v1/learning/insights")
    return {
      data: records.map((record) => ({
        ...insightOf(record),
        containerId: record.agentId,
        relatedTopic: record.topic,
        contributingConversations: record.count,
        archivedAt: null,
      })),
      nextCursor: null,
    };
  if (request.path === "/api/v1/learning/skills")
    return {
      asOf: request.query?.asOf ?? "fixtureSkillCapture",
      data: records.map((record) => ({
        id: record.id,
        containerId: record.agentId,
        name: record.name,
        status: "published",
        createdAt: at,
        liveVersion: {
          skillVersionId: `version-3-${record.agentId}`,
          revision: 3,
          registryRevision: 7,
        },
        reviewer: actor,
        reviewedAt: at,
        delivery: { enabled: false, lastChangedBy: actor, lastChangedAt: at },
        loads: {
          count: loadsOf(record).length,
          runCount: new Set(loadsOf(record).map((load) => load.runId)).size,
          from,
          to,
        },
      })),
      nextCursor: null,
    };
  const record = records.find(
    (entry) => request.path === `/api/v1/learning/skills/${entry.id}/lineage`,
  );
  if (record)
    return {
      ...(request.query?.from || request.query?.to
        ? { loadsWindow: { from, to } }
        : {}),
      skill: {
        id: record.id,
        containerId: record.agentId,
        name: record.name,
        status: "published",
        createdAt: at,
      },
      contributingConversations: [
        { threadId: record.threadId, insightIds: [record.insightId] },
      ],
      insights: [insightOf(record)],
      reviews: [
        {
          candidateId: `candidate-${record.agentId}`,
          event: "approved",
          operation: "update",
          actor,
          occurredAt: at,
          skillVersionId: `version-3-${record.agentId}`,
          publishedRegistryRevision: 7,
        },
      ],
      versions: [
        {
          skillVersionId: `version-3-${record.agentId}`,
          revision: 3,
          name: record.name,
          status: "published",
          createdAt: at,
          publishedRegistryRevision: 7,
          supersededRegistryRevision: null,
          registryRevisions: [
            { revision: 7, publishedAt: at, revokedAt: null },
          ],
          loads: {
            data: loadsOf(record),
            nextCursor: null,
          },
        },
      ],
    };
  if (request.path === "/api/v1/learning/topics") {
    const selected = [
      { agentId: "support", label: "Refunds", threadId: "fixture-thread-1" },
      {
        agentId: "billing",
        label: "Billing questions",
        threadId: "fixture-thread-2",
      },
    ].filter(
      (topic) =>
        !request.query?.agentId || topic.agentId === request.query.agentId,
    );
    return {
      status: "ok",
      containerId: null,
      runs: [
        {
          learningRunId: "learning-run-1",
          containerId: "support",
          finalizedAt: at,
          threadsAnalyzed: selected.length,
        },
      ],
      previousRuns: [],
      threadsAnalyzed: selected.length,
      ...(request.query?.compare === "previous_period"
        ? {
            comparison: {
              from: new Date(
                2 * Date.parse(from) - Date.parse(to),
              ).toISOString(),
              to: from,
              threadsAnalyzed: 0,
            },
          }
        : {}),
      topics: selected.map((topic) => ({
        label: topic.label,
        threadCount: 1,
        share: 1 / selected.length,
        previousThreadCount: null,
        delta: null,
        threadIds: [topic.threadId],
      })),
      nextCursor: null,
    };
  }
  return undefined;
}
