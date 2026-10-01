/**
 * The learning step behind `POST /api/learning/v1/learn`. SERVER-ONLY.
 *
 * Input: the latest trajectory the agent failed and a person completed, with
 * its captured events and linked Threads. Output: one Insight, one Skill
 * candidate and eval candidates, every one citing real eventIds from that
 * trajectory.
 *
 * Two paths that produce the same shapes:
 *  - `deriveWithLlm`: an OpenAI call over the real events (OPENAI_API_KEY),
 *    whose citations are checked against the trajectory; anything it invents is
 *    dropped, and a skill that does not name the action the user took is
 *    rejected.
 *  - `deriveFallback`: deterministic, read straight off the events. Used when
 *    there is no key, the call fails or times out, or the LLM answer does not
 *    survive the checks. The result says which path made it (`derivedBy`).
 */

import OpenAI from "openai";
import type {
  CapturedEvent,
  EvalCandidate,
  Insight,
  Skill,
  TrajectoryDetail,
} from "./types";
import { SKILL_NAME } from "./types";

export interface Facts {
  trajectoryId: string;
  reportId: string;
  employee: string;
  userName: string;
  holdCode: string;
  holdText: string;
  category: string;
  threshold: number;
  costCenterId: string;
  costCenterName: string;
  failedAttempts: number;
  threadCount: number;
  surfaces: string[];
  /** The events that carry the lesson, in order. */
  evidence: {
    panel?: CapturedEvent;
    allocateClick?: CapturedEvent;
    allocated?: CapturedEvent;
    approved?: CapturedEvent;
    reimbursed?: CapturedEvent;
  };
}

export interface Learned {
  insights: Insight[];
  skills: Skill[];
  evalCandidates: EvalCandidate[];
  derivedBy: "llm" | "fallback";
  fallbackReason?: string;
}

const str = (v: unknown, d = "") => (typeof v === "string" && v ? v : d);
const fields = (e?: CapturedEvent) =>
  (e?.event.value.fields as Record<string, unknown> | undefined) ?? {};

/** Read the lesson's facts off the captured events. Throws when the trajectory holds no completed fix. */
export function extractFacts(d: TrajectoryDetail): Facts {
  const ev = d.events;
  const byName = (name: string) => ev.filter((e) => e.event.name === name);
  const panel = byName("screen.context").find(
    (e) => fields(e).holdCode || /policy/i.test(str(e.event.value.label)),
  );
  const allocated = [...byName("expense.cost_center_allocated")].pop();
  if (!allocated) {
    throw new Error(
      "NO_FIX_CAPTURED: this trajectory has no cost center allocation to learn from. Complete the report by hand in Ledgerline first.",
    );
  }
  const allocateClick = [...ev]
    .filter(
      (e) =>
        e.event.name === "click" &&
        /allocate/i.test(str(e.event.value.action)) &&
        e.position < allocated.position,
    )
    .pop();
  const approved = byName("expense.report_approved").find(
    (e) => e.position > allocated.position,
  );
  const reimbursed = byName("expense.reimbursed").find(
    (e) => e.position > allocated.position,
  );
  const pf = fields(panel);
  const av = allocated.event.value;
  const failedAttempts = d.threads.reduce(
    (n, t) =>
      n +
      t.agentTrace.filter(
        (x) => x.name === "approveReport" && x.status === "error",
      ).length,
    0,
  );
  const traceCode = d.threads
    .flatMap((t) => t.agentTrace)
    .map((x) => (x.result as Record<string, unknown> | undefined)?.code)
    .find((c) => typeof c === "string") as string | undefined;
  return {
    trajectoryId: d.trajectory.trajectoryId,
    reportId: str(av.reportId, str(pf.reportId, "the report")),
    employee: str(av.employee, str(pf.employee, "the submitter")),
    userName: d.trajectory.user.name,
    holdCode: str(pf.holdCode, traceCode ?? "POL-114"),
    holdText: str(pf.text, str(panel?.event.value.label)),
    category: str(pf.category, "Team event"),
    threshold: typeof pf.threshold === "number" ? pf.threshold : 2500,
    costCenterId: str(av.costCenter, "CC-410"),
    costCenterName: str(av.costCenterName, "Events & Offsites"),
    failedAttempts,
    threadCount: d.threads.length,
    surfaces: d.trajectory.surfaces,
    evidence: { panel, allocateClick, allocated, approved, reimbursed },
  };
}

const ids = (...es: (CapturedEvent | undefined)[]) =>
  es.filter((e): e is CapturedEvent => !!e).map((e) => e.eventId);

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

export function buildSkillMd(
  f: Facts,
  parts: {
    description: string;
    whenToUse: string;
    steps: string[];
    guardrails: string[];
  },
): string {
  const cite = ids(
    f.evidence.panel,
    f.evidence.allocated,
    f.evidence.approved,
    f.evidence.reimbursed,
  );
  return [
    "---",
    `name: ${SKILL_NAME}`,
    `description: ${parts.description}`,
    "---",
    "",
    "# Approve a team-event expense report",
    "",
    "## When to use",
    parts.whenToUse,
    "",
    "## Steps",
    ...parts.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Guardrails",
    ...parts.guardrails.map((g) => `- ${g}`),
    "",
    "## Learned from",
    `Product trajectory ${f.trajectoryId}${cite.length ? ` (events ${cite.join(", ")})` : ""}: ${f.failedAttempts} refused approval attempt${f.failedAttempts === 1 ? "" : "s"} by the agent across ${f.threadCount} Thread${f.threadCount === 1 ? "" : "s"}, then the user completed it by hand.`,
    "",
  ].join("\n");
}

function fallbackParts(f: Facts) {
  return {
    description: `Use when approving an expense report blocked by POLICY_HOLD ${f.holdCode}: a ${f.category} report over ${money(f.threshold)} that is still charged to a department cost center.`,
    whenToUse: `approveReport returns POLICY_HOLD ${f.holdCode}, or you are about to approve a ${f.category} report whose total is over ${money(f.threshold)}. The rule behind the hold is shown in the report's Policy panel: "${f.holdText || `${f.category} reports over ${money(f.threshold)} need an events cost center`}".`,
    steps: [
      `Call getReport to confirm the category is "${f.category}", the total is over ${money(f.threshold)} and hold ${f.holdCode} is open.`,
      `Call allocateCostCenter with the report id and "${f.costCenterId}" (${f.costCenterName}), the events cost center the policy requires.`,
      "Approve it: approveAndReimburse when the user also asked for reimbursement (one confirmation card), otherwise approveReport. Approval succeeds once the hold resolves.",
      "If you used approveReport and the user asked for reimbursement, call reimburseReport.",
      `Confirm in one sentence: the report, the amount, and that it was moved to ${f.costCenterId} ${f.costCenterName} before approval.`,
    ],
    guardrails: [
      `Only reallocate ${f.category} reports over ${money(f.threshold)} held by ${f.holdCode}. Never move other spend to ${f.costCenterId}.`,
      "Do not add notes or retry approval as a workaround for this hold; allocation is what clears it.",
    ],
  };
}

function fallbackInsight(f: Facts, now: number): Insight {
  return {
    id: "ins_01",
    title: `${f.category.replace(/\s+/g, "-")} reports over ${money(f.threshold)} need an events cost center before approval`,
    summary:
      `The agent tried to approve ${f.reportId} ${f.failedAttempts} time${f.failedAttempts === 1 ? "" : "s"} across ${f.threadCount} Thread${f.threadCount === 1 ? "" : "s"} and stopped at POLICY_HOLD ${f.holdCode}. ` +
      `${f.userName} then cleared it by hand: read the report's Policy panel, allocated the report to ${f.costCenterId} ${f.costCenterName}, approved it and reimbursed it. ` +
      "The rule was on screen and never in the agent's context.",
    evidence: [
      {
        trajectoryId: f.trajectoryId,
        eventIds: ids(
          f.evidence.panel,
          f.evidence.allocateClick,
          f.evidence.allocated,
          f.evidence.approved,
          f.evidence.reimbursed,
        ),
        quote: f.evidence.panel
          ? `Policy panel: ${f.holdText}`
          : `Allocated ${f.reportId} to ${f.costCenterId} ${f.costCenterName}`,
      },
    ],
    threadCount: f.threadCount,
    createdAt: now,
    derivedBy: "fallback",
  };
}

function fallbackEvals(f: Facts): EvalCandidate[] {
  const src = [f.trajectoryId];
  return [
    {
      id: "evc_01",
      query: `Approve a team-event expense report over ${money(f.threshold)}`,
      checks: [
        `Calls allocateCostCenter with an events cost center (${f.costCenterId}) before approveReport`,
        "approveReport succeeds",
        "reimburseReport is called once",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(
        f.evidence.allocated,
        f.evidence.approved,
        f.evidence.reimbursed,
      ),
      status: "pending",
    },
    {
      id: "evc_02",
      query: `Approve ${f.employee}'s ${f.reportId} report and reimburse ${f.employee === "Priya Raman" ? "her" : "them"}`,
      checks: [
        `Loads the ${SKILL_NAME} skill after POLICY_HOLD ${f.holdCode}`,
        `allocateCostCenter("${f.reportId}", "${f.costCenterId}") is called exactly once`,
        "Ends with the report reimbursed, no addNote retries",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(
        f.evidence.panel,
        f.evidence.allocated,
        f.evidence.reimbursed,
      ),
      status: "pending",
    },
    {
      id: "evc_03",
      query: `Approve a team-event report under ${money(f.threshold)}`,
      checks: [
        "approveReport succeeds on the first call",
        "allocateCostCenter is NOT called",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(f.evidence.panel),
      status: "pending",
    },
  ];
}

export function deriveFallback(
  d: TrajectoryDetail,
  revision: number,
  now = Date.now(),
  reason?: string,
): Learned {
  const f = extractFacts(d);
  const parts = fallbackParts(f);
  return {
    insights: [fallbackInsight(f, now)],
    skills: [
      {
        name: SKILL_NAME,
        status: "candidate",
        description: parts.description,
        skillMd: buildSkillMd(f, parts),
        supportingInsightIds: ["ins_01"],
        revision,
        updatedAt: now,
      },
    ],
    evalCandidates: fallbackEvals(f),
    derivedBy: "fallback",
    fallbackReason: reason,
  };
}

// ── LLM path ───────────────────────────────────────────────────────────────

interface LlmAnswer {
  insight?: {
    title?: string;
    summary?: string;
    evidenceEventIds?: string[];
    quote?: string;
  };
  skill?: {
    description?: string;
    whenToUse?: string;
    steps?: string[];
    guardrails?: string[];
  };
  evalCandidates?: {
    query?: string;
    checks?: string[];
    sourceEventIds?: string[];
  }[];
}

const SYSTEM = `You are the learning step of an Automatic Learning system for an in-app AI agent.
You receive one product trajectory: the AG-UI CUSTOM events a user produced in the Ledgerline expense app (each with an eventId), plus the agent traces of the Threads where the agent attempted the same task and failed.
Explain why the agent failed and what the user did instead, and write a reusable skill the agent can follow next time.
Rules:
- Cite only eventIds that appear in the input. Never invent ids.
- The skill's steps must use the agent's tools by name: getReport, allocateCostCenter, approveReport, reimburseReport. Name the exact cost center id the user chose.
- The insight title states the RULE that was learned, as a short declarative sentence (for example "X reports over $N need Y before approval"), not a description of the failure.
- The skill's last steps: approveReport, then reimburseReport only if the user asked for reimbursement.
- Write exactly three eval candidates: the general case, this exact request, and a negative case where the skill must NOT apply.
- Be specific and short. No em dashes.
Answer with JSON only:
{"insight":{"title":string,"summary":string,"evidenceEventIds":[string],"quote":string},
 "skill":{"description":string (starts "Use when"),"whenToUse":string,"steps":[string],"guardrails":[string]},
 "evalCandidates":[{"query":string,"checks":[string],"sourceEventIds":[string]}]}`;

function compactInput(d: TrajectoryDetail) {
  return {
    trajectoryId: d.trajectory.trajectoryId,
    outcome: d.trajectory.outcome,
    events: d.events.map((e) => ({
      eventId: e.eventId,
      name: e.event.name,
      value: e.event.value,
    })),
    threads: d.threads.map((t) => ({
      threadId: t.threadId,
      surface: t.surface,
      outcome: t.outcome,
      messages: t.messages.map((m) => ({
        role: m.role,
        text: m.text.slice(0, 400),
      })),
      toolCalls: t.agentTrace
        .filter((x) => x.kind === "tool.call")
        .map((x) => ({
          name: x.name,
          args: x.args,
          status: x.status,
          result: JSON.stringify(x.result ?? null).slice(0, 300),
        })),
    })),
    missingContext: d.missingContext,
  };
}

const noDash = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

export async function deriveWithLlm(
  d: TrajectoryDetail,
  revision: number,
  opts: {
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
    now?: number;
  } = {},
): Promise<Learned> {
  const now = opts.now ?? Date.now();
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const base = deriveFallback(d, revision, now);
  if (!apiKey) return { ...base, fallbackReason: "OPENAI_API_KEY is not set" };
  const f = extractFacts(d);
  const real = new Set(d.events.map((e) => e.eventId));
  const keep = (list?: string[]) => (list ?? []).filter((id) => real.has(id));

  let answer: LlmAnswer;
  try {
    const client = new OpenAI({
      apiKey,
      timeout: opts.timeoutMs ?? 30_000,
      maxRetries: 0,
    });
    const res = await client.chat.completions.create({
      model: opts.model ?? process.env.LEARN_MODEL ?? "gpt-4.1",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(compactInput(d)) },
      ],
    });
    answer = JSON.parse(res.choices[0]?.message?.content ?? "{}") as LlmAnswer;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[ledgerline/learn] LLM call failed, using the deterministic fallback: ${reason}`,
    );
    return { ...base, fallbackReason: `LLM call failed: ${reason}` };
  }

  const steps = (answer.skill?.steps ?? []).filter(
    (s) => typeof s === "string" && s.trim(),
  );
  const stepsText = steps.join(" ");
  const skillOk =
    steps.length >= 2 &&
    /allocateCostCenter/.test(stepsText) &&
    stepsText.includes(f.costCenterId) &&
    /approveReport/.test(stepsText) &&
    typeof answer.skill?.description === "string";
  const evidenceIds = keep(answer.insight?.evidenceEventIds);
  if (!skillOk || evidenceIds.length === 0 || !answer.insight?.title) {
    const reason = !skillOk
      ? "the LLM skill did not name the allocation the user made"
      : "the LLM cited no eventIds from this trajectory";
    console.warn(
      `[ledgerline/learn] ${reason}; using the deterministic fallback`,
    );
    return { ...base, fallbackReason: reason };
  }

  const fb = fallbackParts(f);
  const parts = {
    description: noDash(answer.skill!.description!.trim()),
    whenToUse: noDash(answer.skill?.whenToUse?.trim() || fb.whenToUse),
    steps: steps.map(noDash),
    guardrails: (answer.skill?.guardrails ?? [])
      .filter((g) => typeof g === "string" && g.trim())
      .map(noDash),
  };
  if (parts.guardrails.length === 0) parts.guardrails = fb.guardrails;

  const insight: Insight = {
    id: "ins_01",
    title: noDash(answer.insight.title.trim()),
    summary: noDash(
      answer.insight.summary?.trim() || base.insights[0]!.summary,
    ),
    evidence: [
      {
        trajectoryId: f.trajectoryId,
        eventIds: evidenceIds,
        quote: noDash(
          answer.insight.quote?.trim() || base.insights[0]!.evidence[0]!.quote,
        ),
      },
    ],
    threadCount: f.threadCount,
    createdAt: now,
    derivedBy: "llm",
  };

  const evals = (answer.evalCandidates ?? [])
    .filter((c) => c.query && Array.isArray(c.checks) && c.checks.length)
    .slice(0, 4)
    .map((c, i): EvalCandidate => {
      const src = keep(c.sourceEventIds);
      return {
        id: `evc_${String(i + 1).padStart(2, "0")}`,
        query: noDash(c.query!),
        checks: c.checks!.map(noDash),
        sourceTrajectoryIds: [f.trajectoryId],
        sourceEventIds: src.length ? src : evidenceIds,
        status: "pending",
      };
    });

  return {
    insights: [insight],
    skills: [
      {
        name: SKILL_NAME,
        status: "candidate",
        description: parts.description,
        skillMd: buildSkillMd(f, parts),
        supportingInsightIds: ["ins_01"],
        revision,
        updatedAt: now,
      },
    ],
    evalCandidates: evals.length ? evals : base.evalCandidates,
    derivedBy: "llm",
  };
}
