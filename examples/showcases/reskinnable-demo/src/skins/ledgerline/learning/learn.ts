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
  /** The policy rule as the user read it on the policy page. */
  holdText: string;
  category: string;
  threshold: number;
  costCenterId: string;
  costCenterName: string;
  /** The lines the user recoded to the events budget, and the ones left alone. */
  recoded: { lineId: string; description: string; from?: string }[];
  kept: { lineId: string; description: string; costCenter?: string }[];
  /** Recode attempts that did NOT clear the hold, before the one that did. */
  wrongAttempts: number;
  failedAttempts: number;
  threadCount: number;
  surfaces: string[];
  /** The events that carry the lesson, in order. */
  evidence: {
    panel?: CapturedEvent;
    policyView?: CapturedEvent;
    costCentersView?: CapturedEvent;
    editCodingClick?: CapturedEvent;
    recoded?: CapturedEvent;
    rechecked?: CapturedEvent;
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

type Change = {
  lineId?: string;
  description?: string;
  from?: string;
  to?: string;
  toName?: string;
};

/** Read the lesson's facts off the captured events. Throws when the trajectory holds no completed fix. */
export function extractFacts(d: TrajectoryDetail): Facts {
  const ev = d.events;
  const byName = (name: string) => ev.filter((e) => e.event.name === name);
  const rechecks = byName("expense.policy_rechecked");
  const rechecked = rechecks.find((e) => e.event.value.status === "resolved");
  const recoded = rechecked
    ? [...byName("expense.lines_recoded")]
        .filter((e) => e.position < rechecked.position)
        .pop()
    : undefined;
  if (!rechecked || !recoded) {
    throw new Error(
      "NO_FIX_CAPTURED: this trajectory has no recode that cleared the hold. Complete the report by hand in Ledgerline first.",
    );
  }
  const before = (e: CapturedEvent) => e.position < recoded.position;
  const contexts = byName("screen.context");
  const panel = contexts.find((e) => fields(e).panel === "Policy");
  const policyView =
    [...contexts].filter((e) => fields(e).policyId && before(e)).pop() ??
    contexts.find((e) => fields(e).policyId);
  const costCentersView =
    [...contexts]
      .filter((e) => fields(e).view === "cost-centers" && before(e))
      .pop() ?? contexts.find((e) => fields(e).view === "cost-centers");
  const editCodingClick = [...ev]
    .filter(
      (e) =>
        e.event.name === "click" &&
        /edit coding/i.test(str(e.event.value.action)) &&
        before(e),
    )
    .pop();
  const approved = byName("expense.report_approved").find(
    (e) => e.position > rechecked.position,
  );
  const reimbursed = byName("expense.reimbursed").find(
    (e) => e.position > rechecked.position,
  );
  const rv = recoded.event.value;
  const changes = (Array.isArray(rv.changes) ? rv.changes : []) as Change[];
  const target = changes.find((c) => c.to)?.to ?? "CC-410";
  const targetName =
    changes.find((c) => c.to === target)?.toName ?? "Events & Offsites";
  const kept = (Array.isArray(rv.unchanged) ? rv.unchanged : []) as {
    lineId: string;
    description: string;
    costCenter?: string;
  }[];
  const pf = fields(panel);
  const policyFields = fields(policyView);
  const failedAttempts = d.threads.reduce(
    (n, t) =>
      n +
      t.agentTrace.filter(
        (x) =>
          (x.name === "approveReport" || x.name === "approveAndReimburse") &&
          x.status === "error",
      ).length,
    0,
  );
  const traceCode = d.threads
    .flatMap((t) => t.agentTrace)
    .map((x) => (x.result as Record<string, unknown> | undefined)?.code)
    .find((c) => typeof c === "string") as string | undefined;
  return {
    trajectoryId: d.trajectory.trajectoryId,
    reportId: str(rv.reportId, str(pf.reportId, "the report")),
    employee: str(rv.employee, str(pf.employee, "the submitter")),
    userName: d.trajectory.user.name,
    holdCode: str(
      pf.holdCode,
      str(policyFields.policyId, traceCode ?? "POL-114"),
    ),
    holdText: str(policyFields.text, str(policyView?.event.value.label)),
    category: str(pf.category, "Team event"),
    threshold: typeof pf.threshold === "number" ? pf.threshold : 2500,
    costCenterId: target,
    costCenterName: targetName,
    recoded: changes
      .filter((c) => c.to === target)
      .map((c) => ({
        lineId: str(c.lineId),
        description: str(c.description),
        from: c.from,
      })),
    kept,
    wrongAttempts: rechecks.filter(
      (e) => e.event.value.status === "open" && e.position < rechecked.position,
    ).length,
    failedAttempts,
    threadCount: d.threads.length,
    surfaces: d.trajectory.surfaces,
    evidence: {
      panel,
      policyView,
      costCentersView,
      editCodingClick,
      recoded,
      rechecked,
      approved,
      reimbursed,
    },
  };
}

const ids = (...es: (CapturedEvent | undefined)[]) =>
  es.filter((e): e is CapturedEvent => !!e).map((e) => e.eventId);

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

const lineList = (ls: { description: string }[]) =>
  ls
    .map((l) => l.description.split(",")[0]!.trim().toLowerCase())
    .join(" and ") || "the event lines";

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
    f.evidence.policyView,
    f.evidence.costCentersView,
    f.evidence.recoded,
    f.evidence.rechecked,
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
    `Product trajectory ${f.trajectoryId}${cite.length ? ` (events ${cite.join(", ")})` : ""}: ${f.failedAttempts} refused approval attempt${f.failedAttempts === 1 ? "" : "s"} by the agent across ${f.threadCount} Thread${f.threadCount === 1 ? "" : "s"}, then the user read the policy, found the events-budget cost center and recoded the event lines by hand.`,
    "",
  ].join("\n");
}

function fallbackParts(f: Facts) {
  const ev = lineList(f.recoded);
  return {
    description: `Use when approving an expense report blocked by POLICY_HOLD ${f.holdCode} (allocation required): a ${f.category} report over ${money(f.threshold)} whose event lines are still coded to a department cost center.`,
    whenToUse: `approveReport returns POLICY_HOLD ${f.holdCode}, or you are about to approve a ${f.category} report over ${money(f.threshold)}. The policy says: "${f.holdText || `Team events over ${money(f.threshold)} must be coded to the cost center that owns the events budget`}". The cost center that owns the events budget is ${f.costCenterId} ${f.costCenterName}.`,
    steps: [
      `Call getReport to confirm the category is "${f.category}", the total is over ${money(f.threshold)} and hold ${f.holdCode} is open, and to read the lineIds.`,
      `Call recodeLines to recode only the event lines (the ${ev}) to "${f.costCenterId}" (${f.costCenterName}), the events-budget cost center. Leave the other lines (${lineList(f.kept)}) on their current cost center.`,
      "Approve it: approveAndReimburse when the user also asked for reimbursement (one confirmation card), otherwise approveReport. Approval succeeds once the hold resolves.",
      "If you used approveReport and the user asked for reimbursement, call reimburseReport.",
      `Confirm in one sentence: the report, the amount, and which lines moved to ${f.costCenterId} ${f.costCenterName}.`,
    ],
    guardrails: [
      `Recode only event spend (venue, catering) to ${f.costCenterId}. Recoding every line, or using another cost center, does not clear ${f.holdCode}.`,
      "Do not add notes or retry approval as a workaround for this hold; the line coding is what clears it.",
    ],
  };
}

function fallbackInsight(f: Facts, now: number): Insight {
  return {
    id: "ins_01",
    title: `${f.category.replace(/\s+/g, "-")} reports over ${money(f.threshold)} need their event lines on the events-budget cost center`,
    summary:
      `The agent tried to approve ${f.reportId} ${f.failedAttempts} time${f.failedAttempts === 1 ? "" : "s"} across ${f.threadCount} Thread${f.threadCount === 1 ? "" : "s"} and stopped at POLICY_HOLD ${f.holdCode} (allocation required). ` +
      `${f.userName} worked it out by hand: opened the policy, found on the Cost centers page that ${f.costCenterId} ${f.costCenterName} owns the events budget, and recoded only the ${lineList(f.recoded)} lines to it${f.wrongAttempts ? ` (after ${f.wrongAttempts} recode${f.wrongAttempts === 1 ? "" : "s"} that did not clear the hold)` : ""}, then approved and reimbursed. ` +
      "Neither the policy text nor the budget types were in the agent's context.",
    evidence: [
      {
        trajectoryId: f.trajectoryId,
        eventIds: ids(
          f.evidence.policyView,
          f.evidence.costCentersView,
          f.evidence.editCodingClick,
          f.evidence.recoded,
          f.evidence.rechecked,
          f.evidence.approved,
          f.evidence.reimbursed,
        ),
        quote: f.holdText
          ? `Policy ${f.holdCode}: ${f.holdText}`
          : `Recoded ${lineList(f.recoded)} to ${f.costCenterId} ${f.costCenterName}`,
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
        `Calls recodeLines moving only the event lines to the events-budget cost center (${f.costCenterId}) before approving`,
        "Approval succeeds",
        "The report ends reimbursed",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(
        f.evidence.recoded,
        f.evidence.rechecked,
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
        `recodeLines moves exactly ${f.recoded.map((l) => l.lineId).join(" and ")} to ${f.costCenterId}; ${f.kept.map((l) => l.lineId).join(" and ") || "the other lines"} stay put`,
        "Ends with the report reimbursed, no addNote retries",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(
        f.evidence.policyView,
        f.evidence.recoded,
        f.evidence.reimbursed,
      ),
      status: "pending",
    },
    {
      id: "evc_03",
      query: `Approve a team-event report under ${money(f.threshold)}`,
      checks: [
        "Approval succeeds on the first call",
        "recodeLines is NOT called",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(f.evidence.policyView),
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
- The skill's steps must use the agent's tools by name: getReport, recodeLines, approveReport or approveAndReimburse, reimburseReport. Name the exact cost center id the user chose, and name every line that moved and every line that stayed by its description and lineId; never say "all event lines" or "relevant lines". Count only the recode that cleared the hold; earlier recodes that did not are mistakes to avoid.
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
    /recodeLines/.test(stepsText) &&
    stepsText.includes(f.costCenterId) &&
    // Each moved line by name or id: "the event lines" alone lets the agent
    // guess, and a guess that moves group transport reopens the hold.
    f.recoded.every(
      (l) =>
        stepsText.includes(l.lineId) ||
        stepsText.toLowerCase().includes(l.description.toLowerCase()),
    ) &&
    /approveReport/.test(stepsText) &&
    typeof answer.skill?.description === "string";
  const evidenceIds = keep(answer.insight?.evidenceEventIds);
  if (!skillOk || evidenceIds.length === 0 || !answer.insight?.title) {
    const reason = !skillOk
      ? "the LLM skill did not name the recode the user made (cost center and each moved line)"
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
