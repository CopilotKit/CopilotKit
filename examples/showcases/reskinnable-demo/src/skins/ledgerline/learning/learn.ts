/**
 * The learning step behind `POST /api/learning/v1/learn`. SERVER-ONLY.
 *
 * Input: the latest trajectory the agent failed and a person completed, with
 * its captured events and linked Threads. Output: one Insight, one Skill
 * candidate and eval candidates, every one citing real eventIds from that
 * trajectory.
 *
 * Today's task is the month-end card close. Receipts auto-match; the lesson
 * is how a person clears the EXCEPTIONS, read straight off the product
 * trajectory: the recorded API calls (a reconciliation session, an allocation
 * split by attendees, a reclass entry in a soft-locked month, a repayment, a
 * missing-receipt affidavit, validate, close) are the RECIPE, and what the
 * person chose on each is the RULE. Both go into the skill exactly; the skill
 * hands the close to the user and never closes the period itself.
 *
 * Two paths that produce the same shapes:
 *  - `deriveWithLlm`: an OpenAI call over the real events (OPENAI_API_KEY)
 *    writes the insight and the eval candidates; its citations are checked
 *    against the trajectory and anything invented is dropped. The skill's
 *    recipe and rules are always the deterministic ones: an API recipe must
 *    be exact.
 *  - `deriveFallback`: deterministic throughout. Used when there is no key,
 *    the call fails, or the answer does not survive the checks. The result
 *    says which path made it (`derivedBy`).
 */

import OpenAI from "openai";
import { CARDS, EVENTS, deptName, glName } from "../data/recon-seed";
import type { ChargeException } from "../data/recon-seed";
import type {
  CapturedEvent,
  EvalCandidate,
  Insight,
  Skill,
  TrajectoryDetail,
} from "./types";
import { SKILL_NAME } from "./types";

export type Resolution =
  | {
      kind: "split";
      allocationId?: string;
      lines: { departmentId: string; amount: number }[];
    }
  | {
      kind: "reclass";
      entryId?: string;
      fromAccount: string;
      toAccount: string;
      memo?: string;
    }
  | {
      kind: "personal";
      repaymentId?: string;
      method: "payroll_deduction" | "card_payment";
    }
  | {
      kind: "missing_receipt";
      affidavitId?: string;
      memo?: string;
      attestedBy?: string;
    };

export interface ExceptionFact {
  transactionId: string;
  descriptor: string;
  amount: number;
  mcc?: string;
  glAccount?: string;
  kind: ChargeException["kind"];
  exception?: ChargeException;
  resolution?: Resolution;
}

export interface Facts {
  trajectoryId: string;
  userName: string;
  cardId: string;
  holder: string;
  last4: string;
  period: string;
  periodLabel: string;
  /** Receipt charges Ledgerline auto-matched. */
  autoMatched: number;
  /** The exceptions the person cleared: the worked examples behind the rules. */
  exceptions: ExceptionFact[];
  /** Charges that failed validation before the passing one. */
  wrongAttempts: { descriptor: string; code: string }[];
  failedAttempts: number;
  threadCount: number;
  surfaces: string[];
  /** The events that carry the lesson, in order. */
  evidence: {
    board?: CapturedEvent;
    contextViews: CapturedEvent[];
    session?: CapturedEvent;
    workflowCalls: CapturedEvent[];
    failedValidation?: CapturedEvent;
    passedValidation: CapturedEvent;
    closed?: CapturedEvent;
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
const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The exception workflows' routes, as the board records them. */
const WORKFLOW = [
  "/allocations",
  "/allocations/[allocationId]/lines",
  "/allocations/[allocationId]/commit",
  "/journal/reclasses",
  "/repayments",
  "/affidavits",
];

/** Read the lesson's facts off the captured events. Throws when the trajectory holds no completed close. */
export function extractFacts(d: TrajectoryDetail): Facts {
  const ev = d.events;
  const byName = (name: string) => ev.filter((e) => e.event.name === name);
  const validated = byName("recon.validated");
  const passed = validated.find((e) => {
    const v = e.event.value;
    return typeof v.total === "number" && v.total > 0 && v.valid === v.total;
  });
  if (!passed) {
    throw new Error(
      "NO_FIX_CAPTURED: this trajectory has no month-end close a person validated. Clear the exceptions by hand on the Card close board first.",
    );
  }
  const pv = passed.event.value;
  const card = CARDS.find((c) => c.id === pv.cardId);
  const exceptions = (
    (Array.isArray(pv.exceptions) ? pv.exceptions : []) as Record<
      string,
      unknown
    >[]
  ).map(
    (x): ExceptionFact => ({
      transactionId: str(x.transactionId),
      descriptor: str(x.descriptor),
      amount: typeof x.amount === "number" ? x.amount : 0,
      mcc: str(x.mcc) || undefined,
      glAccount: str(x.glAccount) || undefined,
      kind: str(x.kind) as ChargeException["kind"],
      exception: (x.exception as ChargeException | undefined) ?? undefined,
      resolution: (x.resolution as Resolution | null | undefined) ?? undefined,
    }),
  );
  const before = (e: CapturedEvent) => e.position < passed.position;
  const failedValidation = [...validated]
    .filter((e) => before(e) && e !== passed)
    .pop();
  const wrong = new Map<string, { descriptor: string; code: string }>();
  for (const e of validated.filter(before)) {
    const results = (
      Array.isArray(e.event.value.results) ? e.event.value.results : []
    ) as Record<string, unknown>[];
    for (const r of results) {
      if (r.valid || r.code === "UNRESOLVED" || r.code === "UNMATCHED")
        continue;
      wrong.set(str(r.transactionId), {
        descriptor: str(r.descriptor),
        code: str(r.code),
      });
    }
  }
  const network = byName("network");
  const route = (e: CapturedEvent) => str(e.event.value.route);
  const session = network.find(
    (e) =>
      route(e).endsWith("/reconciliation/sessions") &&
      e.event.value.method === "POST" &&
      before(e),
  );
  const workflowCalls = network.filter(
    (e) => WORKFLOW.some((w) => route(e).endsWith(w)) && before(e),
  );
  const contexts = byName("screen.context");
  const board = contexts.find((e) => fields(e).view === "reconcile");
  const contextViews = contexts.filter(
    (e) => str(fields(e).view).startsWith("close.") && before(e),
  );
  const closed = byName("recon.period_closed").find(
    (e) => e.position > passed.position,
  );
  const failedAttempts = d.threads.reduce(
    (n, t) =>
      n +
      t.agentTrace.filter((x) => {
        if (x.name === "reviewMatches") return x.status === "error";
        if (x.name !== "ledgerlineApi") return false;
        const body = (
          x.result as
            | { status?: number; body?: { valid?: unknown; total?: unknown } }
            | undefined
        )?.body;
        return (
          x.status === "error" ||
          (typeof body?.valid === "number" && body.valid !== body.total)
        );
      }).length,
    0,
  );
  return {
    trajectoryId: d.trajectory.trajectoryId,
    userName: d.trajectory.user.name,
    cardId: str(pv.cardId),
    holder: card?.holder ?? "the cardholder",
    last4: card?.last4 ?? "",
    period: str(pv.period, card?.period ?? ""),
    periodLabel: card?.periodLabel ?? str(pv.period),
    autoMatched: Array.isArray(pv.pairs) ? pv.pairs.length : 0,
    exceptions,
    wrongAttempts: [...wrong.values()],
    failedAttempts,
    threadCount: d.threads.length,
    surfaces: d.trajectory.surfaces,
    evidence: {
      board,
      contextViews,
      session,
      workflowCalls,
      failedValidation,
      passedValidation: passed,
      closed,
    },
  };
}

const ids = (...es: (CapturedEvent | undefined)[]) =>
  es.filter((e): e is CapturedEvent => !!e).map((e) => e.eventId);

export interface SkillParts {
  description: string;
  whenToUse: string;
  steps: string[];
  rules: string[];
  guardrails: string[];
}

const of = (f: Facts, kind: ExceptionFact["kind"]) =>
  f.exceptions.find((x) => x.kind === kind);

/** The skill: the recipe from the recorded calls, the rules from what the person chose. */
export function skillParts(f: Facts): SkillParts {
  const split = of(f, "split");
  const reclass = of(f, "reclass");
  const personal = of(f, "personal");
  const missing = of(f, "missing_receipt");
  const ev =
    split?.exception?.kind === "split"
      ? EVENTS.find(
          (e) =>
            e.id ===
            (split.exception as { kind: "split"; eventId: string }).eventId,
        )
      : undefined;
  const splitLines =
    split?.resolution?.kind === "split" ? split.resolution.lines : [];
  const rc =
    reclass?.resolution?.kind === "reclass" ? reclass.resolution : null;
  const rp =
    personal?.resolution?.kind === "personal" ? personal.resolution : null;
  const af =
    missing?.resolution?.kind === "missing_receipt" ? missing.resolution : null;
  const rules = [
    `Shared event charges (the charge has an eventId): split by the event's attendees, each department's share of the headcount, to the cent, with the last line taking the rounding so the lines add up to the charge exactly${
      split && ev
        ? ` (${split.descriptor}, ${money(split.amount)}: ${ev.name}, ${ev.attendees.map((a) => `${deptName(a.departmentId)} ${a.count}`).join(", ")} = ${splitLines.map((l) => `${deptName(l.departmentId)} ${money(l.amount)}`).join(", ")})`
        : ""
    }.`,
    `Software coded to the default account: a charge with merchant category 5734 (software) auto-coded to 6100 ${glName("6100")} is reclassed to 6420 ${glName("6420")}. The month is soft-locked for coding edits, so it is always a reclass entry, never an edit${
      reclass && rc
        ? ` (${reclass.descriptor}: ${rc.fromAccount} to ${rc.toAccount})`
        : ""
    }.`,
    `Personal charges: when the cardholder's note on the charge says it is personal, record a repayment with method "payroll_deduction" (the default for personal charges under $500)${
      personal && rp
        ? ` (${personal.descriptor}, ${money(personal.amount)}: ${rp.method === "payroll_deduction" ? "payroll deduction" : "card payment"})`
        : ""
    }.`,
    `Missing receipts (receiptStatus "missing"): request a missing-receipt affidavit with the business purpose in one sentence (what the charge was for, from the merchant, the date and the trip or event it belongs to). The cardholder signs it${
      missing && af?.memo ? ` (${missing.descriptor}: "${af.memo}")` : ""
    }.`,
    "Receipt charges are already auto-matched when the session opens (tips, foreign currency and two-receipt charges included). Leave them alone.",
  ];
  return {
    description:
      "Use when asked to close out a corporate card's month (the month-end card close): clears the card's exceptions through their own workflows (split, reclass, personal, missing receipt), validates, then hands the close to the user to confirm. Never closes the period itself. Not for questions about what is left: answer those from GET /cards.",
    whenToUse: `The user asks to close out, reconcile or finish the month-end close for a card. Editing a charge directly is refused (PERIOD_SOFT_LOCKED, ALLOCATION_REQUIRED, NOT_EDITABLE, RECEIPT_REQUIRED): each exception has its own workflow below.`,
    steps: [
      "ledgerlineApi GET /cards to find the card (its id and openPeriod), then GET /transactions?card=<card id>&status=needs_attention, and GET /transactions/<id> for each one (its glAccount, mcc, eventId, cardholderNote, receiptStatus).",
      'ledgerlineApi POST /reconciliation/sessions with body {"period": "<openPeriod>", "cardId": "<card id>"}. Receipts auto-match; keep the session id it returns.',
      'SPLIT (the charge has an eventId): GET /events/<eventId> for its attendees by department, POST /allocations with {"transactionId": "<id>"}, then PUT /allocations/<allocation id>/lines with {"lines": [{"departmentId": "<id>", "amount": <amount>}]} split by the rules, then POST /allocations/<allocation id>/commit.',
      'RECLASS (software coded to 6100): POST /journal/reclasses with {"transactionId": "<id>", "fromAccount": "<its glAccount>", "toAccount": "6420", "memo": "<one line why>"}.',
      'PERSONAL (the cardholder note says personal): POST /repayments with {"transactionId": "<id>", "method": "payroll_deduction"}.',
      'MISSING RECEIPT (receiptStatus "missing"): POST /affidavits with {"transactionId": "<id>", "memo": "<business purpose>"}.',
      "ledgerlineApi POST /reconciliation/sessions/<session id>/validate. If a charge comes back WRONG_SPLIT or WRONG_ACCOUNT, fix it by the rules and validate again.",
      "When every charge is valid, call reviewMatches with the session id and stop. Only the user's Confirm closes the month.",
    ],
    rules,
    guardrails: [
      "Never call POST /reconciliation/sessions/{id}/close and never close a period yourself: reviewMatches hands it to the user, and only their Confirm validates and closes.",
      "Do not PATCH transactions: every exception is cleared through its own workflow.",
      "Use only ids the API returned. Do not invent transaction, event, department or account ids.",
    ],
  };
}

export function buildSkillMd(f: Facts, parts: SkillParts): string {
  const cite = ids(
    f.evidence.board,
    f.evidence.session,
    ...f.evidence.workflowCalls.slice(0, 4),
    f.evidence.failedValidation,
    f.evidence.passedValidation,
    f.evidence.closed,
  );
  return [
    "---",
    `name: ${SKILL_NAME}`,
    `description: ${parts.description}`,
    "---",
    "",
    "# Close out a card's month: clear the exceptions",
    "",
    "## When to use",
    parts.whenToUse,
    "",
    "## Steps",
    ...parts.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Rules",
    ...parts.rules.map((r) => `- ${r}`),
    "",
    "## Guardrails",
    ...parts.guardrails.map((g) => `- ${g}`),
    "",
    "## Learned from",
    `Product trajectory ${f.trajectoryId}${cite.length ? ` (events ${cite.join(", ")})` : ""}: the agent could not clear ${f.holder}'s ${f.exceptions.length} ${f.periodLabel} exceptions (${f.failedAttempts} failed attempt${f.failedAttempts === 1 ? "" : "s"} across ${f.threadCount} Thread${f.threadCount === 1 ? "" : "s"}); ${f.userName} cleared them on the Card close board, validated, and closed ${f.periodLabel}.`,
    "",
  ].join("\n");
}

function fallbackInsight(f: Facts, now: number): Insight {
  const how = f.exceptions
    .map((x) =>
      x.kind === "split"
        ? `split ${x.descriptor} by attendees`
        : x.kind === "reclass"
          ? `reclassed ${x.descriptor} to 6420`
          : x.kind === "personal"
            ? `marked ${x.descriptor} personal for payroll repayment`
            : `requested an affidavit for ${x.descriptor}`,
    )
    .join(", ");
  return {
    id: "ins_01",
    title:
      "Month-end exceptions are cleared through their own workflows, never by editing the charge",
    summary:
      `The agent tried to clear ${f.holder}'s ${f.exceptions.length} ${f.periodLabel} exceptions by editing the charges and failed ${f.failedAttempts} time${f.failedAttempts === 1 ? "" : "s"} across ${f.threadCount} Thread${f.threadCount === 1 ? "" : "s"}: coding is soft-locked, a shared charge is an allocation, personal is not a field, and a charge with no receipt needs an affidavit. ` +
      `${f.userName} cleared them on the Card close board (${how})${f.wrongAttempts.length ? `, after ${f.wrongAttempts.length} failed validation` : ""}, then validated and closed ${f.periodLabel}. ` +
      "Each workflow, and the headcount the split follows, exist only on that screen.",
    evidence: [
      {
        trajectoryId: f.trajectoryId,
        eventIds: ids(
          f.evidence.board,
          ...f.evidence.contextViews.slice(0, 4),
          f.evidence.session,
          ...f.evidence.workflowCalls,
          f.evidence.failedValidation,
          f.evidence.passedValidation,
          f.evidence.closed,
        ),
        quote: str(
          fields(f.evidence.board).text,
          "Each exception is cleared in its own workflow.",
        ),
      },
    ],
    threadCount: f.threadCount,
    createdAt: now,
    derivedBy: "fallback",
  };
}

function fallbackEvals(f: Facts): EvalCandidate[] {
  const src = [f.trajectoryId];
  const split = of(f, "split");
  const reclass = of(f, "reclass");
  const personal = of(f, "personal");
  const missing = of(f, "missing_receipt");
  const lines =
    split?.resolution?.kind === "split" ? split.resolution.lines : [];
  return [
    {
      id: "evc_01",
      query:
        "Close out a corporate card's month: clear its exceptions and hand the close over for confirmation",
      checks: [
        "Creates a reconciliation session before clearing exceptions",
        "Splits a shared event charge by attendee headcount through an allocation (draft, lines, commit)",
        "Reclasses a miscoded software charge with a journal reclass entry, never a coding edit",
        "Records a personal charge as a payroll-deduction repayment and requests an affidavit for a missing receipt",
        "Does not close the period without user confirmation: ends with the Review card",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(
        f.evidence.session,
        ...f.evidence.workflowCalls,
        f.evidence.passedValidation,
      ),
      status: "pending",
    },
    {
      id: "evc_02",
      query: `Close out ${f.holder}'s ${f.periodLabel} card`,
      checks: [
        ...(split
          ? [
              `Allocates ${split.descriptor} as ${lines.map((l) => `${deptName(l.departmentId)} ${money(l.amount)}`).join(", ")}`,
            ]
          : []),
        ...(reclass
          ? [`Reclasses ${reclass.descriptor} from 6100 to 6420`]
          : []),
        ...(personal
          ? [`Records ${personal.descriptor} as a payroll-deduction repayment`]
          : []),
        ...(missing
          ? [`Requests a missing-receipt affidavit for ${missing.descriptor}`]
          : []),
        "Validation returns every charge valid before reviewMatches",
        "Never calls /close",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(
        f.evidence.failedValidation,
        f.evidence.passedValidation,
        f.evidence.closed,
      ),
      status: "pending",
    },
    {
      id: "evc_03",
      query: "Which expense reports are waiting for my approval?",
      checks: [
        `Does not load the ${SKILL_NAME} skill`,
        "Does not create a reconciliation session",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(f.evidence.board),
      status: "pending",
    },
  ];
}

function skillFrom(
  f: Facts,
  parts: SkillParts,
  revision: number,
  now: number,
): Skill {
  return {
    name: SKILL_NAME,
    status: "candidate",
    description: parts.description,
    skillMd: buildSkillMd(f, parts),
    supportingInsightIds: ["ins_01"],
    revision,
    updatedAt: now,
  };
}

export function deriveFallback(
  d: TrajectoryDetail,
  revision: number,
  now = Date.now(),
  reason?: string,
): Learned {
  const f = extractFacts(d);
  return {
    insights: [fallbackInsight(f, now)],
    skills: [skillFrom(f, skillParts(f), revision, now)],
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
  evalCandidates?: {
    query?: string;
    checks?: string[];
    sourceEventIds?: string[];
  }[];
}

const SYSTEM = `You are the learning step of an Automatic Learning system for an in-app AI agent.
You receive one product trajectory: the AG-UI CUSTOM events a user produced in the Ledgerline expense app (each with an eventId), including the API calls the screen made (network events with route templates and body summaries), plus the agent traces of the Threads where the agent attempted the same task and failed.
The task is a month-end card close. Receipts auto-match; the work is clearing the exceptions: a shared event charge split across departments, a miscoded software charge in a soft-locked month, a personal charge, a charge with no receipt. Explain why the agent failed and what the user did instead.
Rules:
- Cite only eventIds that appear in the input. Never invent ids.
- The insight title states the RULE that was learned, as a short declarative sentence, not a description of the failure.
- The summary names each workflow the user followed (allocation split by attendees, reclass entry, repayment, affidavit, validate, close) and why editing the charge failed.
- Write exactly two eval candidates: the general case, and this exact request. Include checks that the agent creates a reconciliation session first and never closes the period without the user's confirmation.
- Be specific and short. No em dashes.
Answer with JSON only:
{"insight":{"title":string,"summary":string,"evidenceEventIds":[string],"quote":string},
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

  const evidenceIds = keep(answer.insight?.evidenceEventIds);
  if (evidenceIds.length === 0 || !answer.insight?.title) {
    const reason = "the LLM cited no eventIds from this trajectory";
    console.warn(
      `[ledgerline/learn] ${reason}; using the deterministic fallback`,
    );
    return { ...base, fallbackReason: reason };
  }

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
    // The general case and this request from the LLM; the negative case is
    // always ours, so "must not apply" can never be read as "applied badly".
    .slice(0, 2)
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
    // The recipe and the rules stay exact: always the deterministic skill.
    skills: [skillFrom(f, skillParts(f), revision, now)],
    evalCandidates:
      evals.length === 2
        ? [...evals, base.evalCandidates[2]!]
        : base.evalCandidates,
    derivedBy: "llm",
  };
}
