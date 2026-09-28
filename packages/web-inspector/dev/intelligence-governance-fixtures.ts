import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";

/** Supplies a small, consistent governance record for the Inspector workbench. */
export function intelligenceGovernanceFixture(
  request: IntelligenceReadRequest,
): unknown | undefined {
  if (!request.path.startsWith("/api/v1/governance/")) return undefined;
  const leaf = request.path.split("/").at(-1) ?? "";
  if (!["summary", "events", "approvals", "access", "deletions"].includes(leaf))
    return undefined;
  const to = request.query?.to ?? new Date().toISOString();
  const from =
    request.query?.from ??
    new Date(Date.parse(to) - 7 * 86400000).toISOString();
  const at = new Date(
    Date.parse(to) - Math.min(3600000, (Date.parse(to) - Date.parse(from)) / 2),
  ).toISOString();
  const events = [
    {
      family: "approval",
      type: "approval.approved",
      outcome: "approved",
      details: { verified: true, mechanism: "interrupt" },
    },
    {
      family: "approval",
      type: "approval.responded",
      outcome: "answered",
      details: { verified: false, mechanism: "tool_response" },
    },
    {
      family: "access_decision",
      type: "access.denied",
      outcome: "denied",
      details: {
        permission: "conversations.text",
        reason: "Missing permission",
      },
    },
    {
      family: "deletion",
      type: "deletion.thread",
      outcome: "deleted",
      details: { resourceType: "conversation", count: 1 },
    },
    {
      family: "run_activity",
      type: "run.started",
      outcome: "started",
      details: {},
    },
    {
      family: "approval",
      type: "approval.rejected",
      outcome: "rejected",
      details: { verified: true },
    },
    {
      family: "approval",
      type: "approval.requested",
      outcome: "pending",
      details: {},
    },
    {
      family: "run_activity",
      type: "run.finished",
      outcome: "interrupted",
      details: {},
    },
    {
      family: "learning",
      type: "learning.skill_published",
      outcome: "published",
      details: {},
    },
    {
      family: "learning",
      type: "learning.skill_loaded",
      outcome: "loaded",
      details: {},
    },
    {
      family: "approval",
      type: "approval.approved",
      outcome: "approved",
      details: { verified: false },
    },
  ].map((event, index) => ({
    ...event,
    id: `fixture-event-${index + 1}`,
    occurredAt: at,
    receivedAt: at,
    actor: { type: "app_user", id: `reviewer-${index + 1}` },
    agentId: "support",
    threadId: "fixture-thread-1",
    runId: "fixture-run-1",
    toolCallId: "fixture-tool-1",
    toolName: "refund",
    source: "runtime",
    captureVersion: 1,
  }));

  type FixtureEvent = (typeof events)[number];
  const sets: Record<string, (event: FixtureEvent) => boolean> = {
    runs: (event) => event.type === "run.started",
    approvals: (event) =>
      event.type === "approval.approved" && event.details.verified === true,
    rejections: (event) =>
      event.type === "approval.rejected" && event.details.verified === true,
    unansweredApprovals: (event) =>
      event.type === "approval.requested" ||
      (event.type === "run.finished" && event.outcome === "interrupted"),
    accessDenials: (event) => event.type === "access.denied",
    skillChanges: (event) => event.type === "learning.skill_published",
    deletions: (event) => event.family === "deletion",
  };
  const scoped = events.filter(
    (event) =>
      !request.query?.agentId || event.agentId === request.query.agentId,
  );
  if (leaf === "summary") {
    const counts = {
      ...Object.fromEntries(
        Object.entries(sets).map(([key, matches]) => [
          key,
          scoped.filter(matches).length,
        ]),
      ),
      approvalResponses: 0,
      cancellations: 0,
      unverifiedAnswers: scoped.filter(
        (event) =>
          event.family === "approval" &&
          event.type !== "approval.requested" &&
          event.details.verified !== true,
      ).length,
    };
    return {
      captureStartedAt: "2026-09-01T00:00:00.000Z",
      current: { from, to, coverage: "full", counts },
      previous: {
        from: new Date(Date.parse(from) * 2 - Date.parse(to)).toISOString(),
        to: from,
        coverage: "full",
        counts: Object.fromEntries(Object.keys(counts).map((key) => [key, 0])),
      },
    };
  }
  const families: Record<string, string> = {
    approvals: "approval",
    access: "access_decision",
    deletions: "deletion",
  };
  return {
    data: scoped.filter(
      (event) =>
        (!families[leaf] || event.family === families[leaf]) &&
        (!request.query?.family || event.family === request.query.family) &&
        (!request.query?.summary || sets[request.query.summary]?.(event)) &&
        (!request.query?.outcome || event.outcome === request.query.outcome) &&
        (!request.query?.actorId || event.actor.id === request.query.actorId) &&
        (!request.query?.type || event.type === request.query.type),
    ),
    nextCursor: null,
  };
}
