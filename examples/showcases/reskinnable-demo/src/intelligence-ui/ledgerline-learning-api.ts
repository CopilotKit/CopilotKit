"use client";

/**
 * `LearningApi` (the interface the real Intelligence Learning components are
 * written against) implemented over this demo's `/api/learning/v1`.
 *
 * Mapping, demo shape to Intelligence shape:
 * - one Learning Space, `ledgerline-expenses`, holds every captured trajectory;
 * - a demo Insight becomes a `LearningInsight` (title to statement, summary to
 *   impact); its evidence items are the signals: concrete moments in a
 *   trajectory, cited as `trajectoryId~eventId` so the drawer's "Open" link
 *   lands on the exact event (see `/intelligence/threads/[id]`);
 * - a `candidate` Skill becomes a pending Skill candidate whose bundle is its
 *   SKILL.md; `published` becomes a published Skill; Approve and Reject call the
 *   Skill's approve and disable endpoints;
 * - an analysis run is `POST /learn`, tracked here so the copied run list and
 *   progress polling behave as they do against the real platform.
 */
import { learningV1 } from "./data/client";
import { LEDGERLINE_CONTAINER_ID } from "./ids";
import type { DemoInsight, DemoSkill, TrajectoryDetail, TrajectoryEvent } from "./data/contract";
import type {
  LearningApi,
  LearningCandidate,
  LearningCandidateDetail,
  LearningContainer,
  LearningInsight,
  LearningInsightEvidence,
  LearningRun,
  LearningSkill,
} from "./learning/learning-api";

export { LEDGERLINE_CONTAINER_ID };
export const LEDGERLINE_PROJECT_ID = 1;
const CONTAINER_NAME = "Ledgerline Expenses";
const ZERO_SHA = "0".repeat(64);

const iso = (ms: number): string => new Date(ms).toISOString();
const PROJECT_CREATED = iso(Date.UTC(2026, 8, 1));

const container: LearningContainer = {
  createdAt: PROJECT_CREATED,
  id: LEDGERLINE_CONTAINER_ID,
  name: CONTAINER_NAME,
  projectId: LEDGERLINE_PROJECT_ID,
  promptContext:
    "Expense approvals in Ledgerline: what users do by hand when the agent cannot finish.",
  updatedAt: PROJECT_CREATED,
};

/** Runs started from this browser session, newest first. */
let sessionRuns: LearningRun[] = [];

/** Cites one signal: a trajectory and the event inside it. */
export const signalRef = (trajectoryId: string, eventId: string): string =>
  `${trajectoryId}~${eventId}`;

function toInsight(insight: DemoInsight, runId: string): LearningInsight {
  return {
    alias: insight.id,
    createdAt: iso(insight.createdAt),
    evidence: insight.evidence.map((e) => ({
      messageIds: [...e.eventIds],
      threadId: signalRef(e.trajectoryId, e.eventIds[0] ?? ""),
    })),
    id: insight.id,
    impact: insight.summary,
    runId,
    skillEligible: true,
    statement: insight.title,
  };
}

const candidateId = (skill: DemoSkill): string => `candidate:${skill.name}`;

function toCandidate(skill: DemoSkill, runId: string, createdAt: string): LearningCandidate {
  return {
    bundleSha256: ZERO_SHA,
    createdAt,
    description: skill.description,
    id: candidateId(skill),
    operation: "add",
    publishedRegistryRevision: null,
    publishedSkillId: null,
    reason: `Supported by ${skill.supportingInsightIds.length === 1 ? "an Insight" : `${skill.supportingInsightIds.length} Insights`} from captured trajectories.`,
    registryBaseRevision: 0,
    reviewedAt: null,
    runId,
    status:
      skill.status === "candidate"
        ? "pending_review"
        : skill.status === "published"
          ? "approved"
          : "rejected",
    subjectSha256: ZERO_SHA,
    targetSkillId: null,
    targetSkillRevision: null,
    title: skill.name,
  };
}

function toSkill(skill: DemoSkill, createdAt: string): LearningSkill {
  return {
    createdAt,
    description: skill.description,
    id: `skill:${skill.name}`,
    name: skill.name,
    revision: skill.revision,
    skillMd: skill.skillMd,
    sourceInsightId: skill.supportingInsightIds[0] ?? "",
    status: "published",
    updatedAt: createdAt,
  };
}

/** The run the current Insights came from, so the list has one even before this session ran one. */
function baselineRun(insights: readonly DemoInsight[], skills: readonly DemoSkill[]): LearningRun | null {
  if (insights.length === 0) return null;
  const at = Math.max(...insights.map((i) => i.createdAt));
  return {
    attemptCount: 1,
    candidateCount: skills.length,
    completedAt: iso(at),
    createdAt: iso(at - 20_000),
    evidenceThreadCount: Math.max(...insights.map((i) => i.threadCount)),
    failureCode: null,
    id: "00000000-a11c-4d00-9e00-000000000001",
    insightCount: insights.length,
    kubernetesJobName: null,
    learningContainerId: LEDGERLINE_CONTAINER_ID,
    projectId: LEDGERLINE_PROJECT_ID,
    startedAt: iso(at - 18_000),
    status: "succeeded",
    triggerSource: "manual",
    updatedAt: iso(at),
  };
}

async function allRuns(): Promise<LearningRun[]> {
  const [insights, skills] = await Promise.all([learningV1.insights(), learningV1.skills()]);
  const base = baselineRun(insights, skills);
  return [...sessionRuns, ...(base && !sessionRuns.some((r) => r.status === "succeeded") ? [base] : [])];
}

const latestRunId = async (): Promise<string> => (await allRuns())[0]?.id ?? "00000000-a11c-4d00-9e00-000000000001";

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function eventLabel(event: TrajectoryEvent | undefined): string {
  if (!event) return "Signal";
  const v = event.event.value;
  switch (event.event.name) {
    case "click":
      return `Clicked "${String(v.action)}"`;
    case "screen.context":
      return String(v.label ?? "Screen context");
    case "network":
      return `${String(v.method)} ${String(v.route)} (${String(v.status)})`;
    case "thread.linked":
      return `${v.surface === "chatgpt" ? "ChatGPT" : "In-app"} Thread linked`;
    default:
      return capitalize(event.event.name.replace(/^[a-z]+\./, "").replace(/[._]/g, " "));
  }
}

async function trajectoryDetails(ids: readonly string[]): Promise<Map<string, TrajectoryDetail | null>> {
  const unique = [...new Set(ids)];
  const rows = await Promise.all(
    unique.map(async (id) => [id, await learningV1.trajectory(id).catch(() => null)] as const),
  );
  return new Map(rows);
}

async function runLearning(): Promise<LearningRun> {
  const now = Date.now();
  const run: LearningRun = {
    attemptCount: 1,
    candidateCount: null,
    completedAt: null,
    createdAt: iso(now),
    evidenceThreadCount: null,
    failureCode: null,
    id: crypto.randomUUID(),
    insightCount: null,
    kubernetesJobName: null,
    learningContainerId: LEDGERLINE_CONTAINER_ID,
    projectId: LEDGERLINE_PROJECT_ID,
    startedAt: iso(now),
    status: "batching",
    triggerSource: "manual",
    updatedAt: iso(now),
  };
  sessionRuns = [run, ...sessionRuns];
  const settle = (patch: Partial<LearningRun>): void => {
    sessionRuns = sessionRuns.map((r) => (r.id === run.id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r));
  };
  // Let the stages read on stage, then settle with the API's real outcome.
  const minimum = new Promise((resolve) => window.setTimeout(resolve, 2500));
  window.setTimeout(() => settle({ status: "reducing" }), 1200);
  learningV1
    .learn()
    .then(async (result) => {
      await minimum;
      settle({
        status: "succeeded",
        completedAt: new Date().toISOString(),
        insightCount: result.insights.length,
        candidateCount: result.skills.length,
        evidenceThreadCount: Math.max(0, ...result.insights.map((i) => i.threadCount)),
      });
    })
    .catch(async (error: unknown) => {
      await minimum;
      settle({ status: "failed", completedAt: new Date().toISOString(), failureCode: error instanceof Error ? error.message : String(error) });
    });
  return run;
}

export const ledgerlineLearningApi: LearningApi = {
  approveCandidate: async (_projectId, _containerId, id) => {
    const name = id.replace(/^candidate:/, "");
    await learningV1.approveSkill(name);
    return { candidateId: id, publishedRegistryRevision: 1, publishedSkillId: `skill:${name}`, status: "approved" };
  },
  rejectCandidate: async (_projectId, _containerId, id) => {
    await learningV1.disableSkill(id.replace(/^candidate:/, ""));
    return { candidateId: id, publishedRegistryRevision: null, publishedSkillId: null, status: "rejected" };
  },
  createContainer: async () => {
    throw new Error("This demo has one Learning Space.");
  },
  updateContainer: async () => container,
  getContainer: async (_p, id) => (id === LEDGERLINE_CONTAINER_ID ? container : null),
  listContainers: async () => ({ containers: [container], nextCursor: null }),
  listContainerStats: async () => {
    const [trajectories, insights] = await Promise.all([learningV1.trajectories(), learningV1.insights()]);
    const lastLearned = insights.length ? Math.max(...insights.map((i) => i.createdAt)) : 0;
    const threadCount = trajectories.reduce((n, t) => n + Math.max(1, t.threadIds.length), 0);
    const pending = trajectories
      .filter((t) => t.outcome === "agent_failed_user_completed" && t.lastEventAt > lastLearned)
      .reduce((n, t) => n + Math.max(1, t.threadIds.length), 0);
    const active = sessionRuns.find((r) => !["succeeded", "failed"].includes(r.status));
    return [
      {
        containerId: LEDGERLINE_CONTAINER_ID,
        hasRuntimeThreads: true,
        lastRunStatus: active ? active.status : insights.length ? "succeeded" : null,
        lastSucceededAt: insights.length ? iso(lastLearned) : null,
        // A captured failure can always be re-learned on stage.
        pendingThreadCount: Math.max(pending, trajectories.some((t) => t.outcome === "agent_failed_user_completed") ? 1 : 0),
        threadCount,
      },
    ];
  },
  listInsights: async () => {
    const [insights, runId] = await Promise.all([learningV1.insights(), latestRunId()]);
    return insights.map((i) => toInsight(i, runId));
  },
  getInsightEvidence: async (_p, _c, insightId) => {
    const insight = (await learningV1.insights()).find((i) => i.id === insightId);
    if (!insight) return [];
    const details = await trajectoryDetails(insight.evidence.map((e) => e.trajectoryId));
    return insight.evidence.map((e): LearningInsightEvidence => {
      const detail = details.get(e.trajectoryId) ?? null;
      const events = [...new Set(e.eventIds)].map((id) => detail?.events.find((x) => x.eventId === id));
      const agentSide = events.some((x) => x?.event.name === "thread.linked");
      return {
        cited: [
          {
            content: e.quote,
            id: `${e.trajectoryId}:${e.eventIds.join(",")}`,
            role: agentSide ? "tool" : "user",
          },
          ...events
            .filter((x): x is TrajectoryEvent => Boolean(x) && eventLabel(x) !== e.quote)
            .map((x) => ({ content: `Signal: ${eventLabel(x)}`, id: x.eventId, role: "user" as const })),
        ],
        messageCount: e.eventIds.length,
        threadId: signalRef(e.trajectoryId, e.eventIds[0] ?? ""),
        threadName: detail ? `${detail.trajectory.title} (trajectory)` : e.trajectoryId,
        threadPresent: true,
        unavailable: null,
      };
    });
  },
  listCandidates: async () => {
    const [skills, runId, insights] = await Promise.all([learningV1.skills(), latestRunId(), learningV1.insights()]);
    const at = iso(insights.length ? Math.max(...insights.map((i) => i.createdAt)) : Date.now());
    return skills.map((s) => toCandidate(s, runId, at));
  },
  getCandidate: async (_p, _c, id): Promise<LearningCandidateDetail> => {
    const [skills, insights, runId] = await Promise.all([learningV1.skills(), learningV1.insights(), latestRunId()]);
    const skill = skills.find((s) => candidateId(s) === id);
    if (!skill) throw new Error(`Skill candidate ${id} was not found.`);
    const at = iso(insights.length ? Math.max(...insights.map((i) => i.createdAt)) : Date.now());
    return {
      ...toCandidate(skill, runId, at),
      bundle: { files: [{ content: skill.skillMd, path: "SKILL.md", sha256: ZERO_SHA }], schemaVersion: 1 },
      supportingInsights: insights
        .filter((i) => skill.supportingInsightIds.includes(i.id))
        .map((i) => ({ alias: i.id, id: i.id, impact: i.summary, statement: i.title })),
    };
  },
  listSkills: async () => {
    const [skills, insights] = await Promise.all([learningV1.skills(), learningV1.insights()]);
    const at = iso(insights.length ? Math.max(...insights.map((i) => i.createdAt)) : Date.now());
    return skills.filter((s) => s.status === "published").map((s) => toSkill(s, at));
  },
  listRuns: async () => allRuns(),
  runLearning: async () => runLearning(),
  getAutomation: async () => {
    const active = sessionRuns.some((r) => !["succeeded", "failed"].includes(r.status));
    return {
      activeRun: active,
      blocked: false,
      containerId: LEDGERLINE_CONTAINER_ID,
      eligibleThreadCount: 1,
      enabled: true,
      projectId: LEDGERLINE_PROJECT_ID,
      requiredThreadCount: 1,
    };
  },
  // The Ledgerline agent loads published Skills, so delivery reads as on.
  getSkillDelivery: async () => true,
  setSkillDelivery: async () => undefined,
};
