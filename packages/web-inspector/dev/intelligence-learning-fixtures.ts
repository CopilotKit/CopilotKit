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
  const id = "10000000-0000-4000-8000-000000000001";
  const actor = { type: "operator", id: "alex@example.test" };
  const insight = {
    id: "insight-1",
    statement: "Check for duplicate charges before issuing a refund",
    impact: "Avoid repeat refunds for the same order",
    createdAt: at,
    learningRunId: "learning-run-1",
    status: "active",
  };
  if (request.path === "/api/v1/learning/insights")
    return {
      data: [
        {
          ...insight,
          containerId: "support",
          relatedTopic: "Refunds",
          contributingConversations: 8,
          archivedAt: null,
        },
      ],
      nextCursor: null,
    };
  if (request.path === "/api/v1/learning/skills")
    return {
      data: [
        {
          id,
          containerId: "support",
          name: "refund-policy",
          status: "published",
          createdAt: at,
          liveVersion: {
            skillVersionId: "version-3",
            revision: 3,
            registryRevision: 7,
          },
          reviewer: actor,
          reviewedAt: at,
          delivery: { enabled: false, lastChangedBy: actor, lastChangedAt: at },
          loads: { count: 12, from, to },
        },
      ],
      nextCursor: null,
    };
  if (request.path === `/api/v1/learning/skills/${id}/lineage`)
    return {
      skill: {
        id,
        containerId: "support",
        name: "refund-policy",
        status: "published",
        createdAt: at,
      },
      contributingConversations: [
        { threadId: "fixture-thread-1", insightIds: ["insight-1"] },
      ],
      insights: [insight],
      reviews: [
        {
          candidateId: "candidate-1",
          event: "approved",
          operation: "update",
          actor,
          occurredAt: at,
          skillVersionId: "version-3",
          publishedRegistryRevision: 7,
        },
      ],
      versions: [
        {
          skillVersionId: "version-3",
          revision: 3,
          name: "refund-policy",
          status: "published",
          createdAt: at,
          publishedRegistryRevision: 7,
          supersededRegistryRevision: null,
          registryRevisions: [
            { revision: 7, publishedAt: at, revokedAt: null },
          ],
          loads: {
            data: [
              {
                runId: "fixture-run-1",
                threadId: "fixture-thread-1",
                agentId: "support",
                occurredAt: at,
              },
            ],
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
