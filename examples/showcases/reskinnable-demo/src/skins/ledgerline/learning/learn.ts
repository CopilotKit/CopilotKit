/**
 * The learning step behind `POST /api/learning/v1/learn`. SERVER-ONLY.
 *
 * Input: the latest trajectory the agent failed and a person completed, with
 * its captured events and linked Threads. Output: one Insight, one Skill
 * candidate and eval candidates, every one citing real eventIds from that
 * trajectory.
 *
 * Today's task is the month-end card close. The lesson is read straight off
 * the product trajectory: the recorded API calls (open a reconciliation
 * session, one pair per charge with its adjustment, validate, close) are the
 * RECIPE, and the pairs the person validated are the MATCHING RULES (card
 * descriptors, posting-date lag, tips written on slips, currency conversion,
 * split charges). Both go into the skill exactly; the skill hands the matches
 * to the user and never closes the period itself.
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
import { CARDS } from "../data/recon-seed";
import type {
  CapturedEvent,
  EvalCandidate,
  Insight,
  Skill,
  TrajectoryDetail,
} from "./types";
import { SKILL_NAME } from "./types";

export interface ReceiptFact {
  id: string;
  merchant: string;
  date: string;
  total: number;
  currency: string;
  handwrittenTip?: number;
}

export interface Adjustment {
  kind: string;
  amount?: number;
  currency?: string;
  receiptAmount?: number;
  rate?: number;
}

export interface PairFact {
  transactionId: string;
  descriptor: string;
  amount: number;
  postedAt?: string;
  receipts: ReceiptFact[];
  adjustment?: Adjustment;
}

export interface Facts {
  trajectoryId: string;
  userName: string;
  cardId: string;
  holder: string;
  last4: string;
  period: string;
  periodLabel: string;
  /** The pairs the person validated: the worked examples behind the rules. */
  pairs: PairFact[];
  /** Pairs that failed validation before the passing one, with the on-screen reason. */
  wrongAttempts: { descriptor: string; code: string; reason?: string }[];
  failedAttempts: number;
  threadCount: number;
  surfaces: string[];
  /** The events that carry the lesson, in order. */
  evidence: {
    board?: CapturedEvent;
    receiptViews: CapturedEvent[];
    session?: CapturedEvent;
    pairCalls: CapturedEvent[];
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
const dayGap = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

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
      "NO_FIX_CAPTURED: this trajectory has no month-end close a person validated. Match the receipts by hand on the Card close board first.",
    );
  }
  const pv = passed.event.value;
  const card = CARDS.find((c) => c.id === pv.cardId);
  const pairs = (
    (Array.isArray(pv.pairs) ? pv.pairs : []) as Record<string, unknown>[]
  ).map(
    (p): PairFact => ({
      transactionId: str(p.transactionId),
      descriptor: str(p.descriptor),
      amount: typeof p.amount === "number" ? p.amount : 0,
      postedAt: str(p.postedAt) || undefined,
      receipts: (Array.isArray(p.receipts) ? p.receipts : []) as ReceiptFact[],
      adjustment: (p.adjustment as Adjustment | undefined) ?? undefined,
    }),
  );
  const before = (e: CapturedEvent) => e.position < passed.position;
  const failedValidation = [...validated]
    .filter((e) => before(e) && e !== passed)
    .pop();
  const wrong = new Map<
    string,
    { descriptor: string; code: string; reason?: string }
  >();
  for (const e of validated.filter(before)) {
    const results = (
      Array.isArray(e.event.value.results) ? e.event.value.results : []
    ) as Record<string, unknown>[];
    for (const r of results) {
      if (r.valid || r.code === "UNMATCHED") continue;
      wrong.set(str(r.transactionId), {
        descriptor: str(r.descriptor),
        code: str(r.code),
        reason: str(r.reason) || undefined,
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
  const pairCalls = network.filter(
    (e) => route(e).endsWith("/sessions/[sessionId]/pairs") && before(e),
  );
  const contexts = byName("screen.context");
  const board = contexts.find((e) => fields(e).view === "reconcile");
  const receiptViews = contexts.filter(
    (e) => fields(e).view === "receipt" && before(e),
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
            | { body?: { valid?: unknown; total?: unknown } }
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
    pairs,
    wrongAttempts: [...wrong.values()],
    failedAttempts,
    threadCount: d.threads.length,
    surfaces: d.trajectory.surfaces,
    evidence: {
      board,
      receiptViews,
      session,
      pairCalls,
      failedValidation,
      passedValidation: passed,
      closed,
    },
  };
}

const ids = (...es: (CapturedEvent | undefined)[]) =>
  es.filter((e): e is CapturedEvent => !!e).map((e) => e.eventId);

/** "SQ *BLUEBOTTLE COFFEE SF" is Blue Bottle Coffee: the descriptors the person resolved. */
function descriptorExamples(f: Facts): string {
  return f.pairs
    .filter((p) => p.receipts[0])
    .map((p) => `"${p.descriptor}" = ${p.receipts[0]!.merchant}`)
    .join("; ");
}

function maxPostingLag(f: Facts): number {
  let max = 0;
  for (const p of f.pairs)
    for (const r of p.receipts)
      if (p.postedAt) max = Math.max(max, dayGap(r.date, p.postedAt));
  return Math.max(max, 2);
}

export interface SkillParts {
  description: string;
  whenToUse: string;
  steps: string[];
  rules: string[];
  guardrails: string[];
}

/** The skill: the recipe from the recorded calls, the rules from the validated pairs. */
export function skillParts(f: Facts): SkillParts {
  const tip = f.pairs.find((p) => p.adjustment?.kind === "gratuity");
  const fx = f.pairs.find((p) => p.adjustment?.kind === "fx_conversion");
  const split = f.pairs.find((p) => p.receipts.length > 1);
  const stale = f.wrongAttempts.find((w) => w.code === "WRONG_RECEIPT");
  const lag = maxPostingLag(f);
  const rules = [
    `Descriptors are the card network's, not the merchant's name: drop prefixes such as "SQ *", "TST* ", "PAYPAL *" and "AMZN MKTP US*" and the trailing city or reference, then match the receipt merchant (${descriptorExamples(f)}).`,
    `A charge posts 0 to ${lag} days after the date printed on its receipt. A receipt dated more than 5 days before the charge belongs to another statement, even when its total is identical${stale ? ` (${(stale.reason ?? `a receipt for ${stale.descriptor} was rejected as WRONG_RECEIPT`).replace(/\.$/, "")})` : ""}.`,
    tip
      ? `Tips: when a restaurant or cafe charge is more than the receipt total, the difference is the tip written on the slip. Add "adjustment": {"kind": "gratuity", "amount": <charge minus receipt total>} (${tip.receipts[0]?.merchant}: receipt ${money(tip.receipts[0]?.total ?? 0)}, charge ${money(tip.amount)}, gratuity ${(tip.adjustment?.amount ?? 0).toFixed(2)}).`
      : `Tips: when a restaurant charge is more than the receipt total, add "adjustment": {"kind": "gratuity", "amount": <charge minus receipt total>}.`,
    fx
      ? `Foreign currency: for a receipt that is not in USD, add "adjustment": {"kind": "fx_conversion", "currency": "<receipt currency>", "receiptAmount": <receipt total>, "rate": <charge / receipt total, 4 decimals>} (${fx.receipts[0]?.merchant}: ${fx.adjustment?.currency} ${(fx.adjustment?.receiptAmount ?? 0).toFixed(2)} to ${money(fx.amount)}, rate ${fx.adjustment?.rate}).`
      : `Foreign currency: for a receipt that is not in USD, add "adjustment": {"kind": "fx_conversion", "currency": "<receipt currency>", "receiptAmount": <receipt total>, "rate": <charge / receipt total, 4 decimals>}.`,
    split
      ? `Split charges: when no single receipt matches, put every receipt from that merchant whose totals add up to the charge in ONE pair's receiptIds (${split.receipts.map((r) => `${r.merchant} ${money(r.total)}`).join(" + ")} = ${money(split.amount)}).`
      : "Split charges: when no single receipt matches, put the receipts that add up to the charge in one pair's receiptIds.",
  ];
  return {
    description:
      "Use when asked to match a card's transactions to their receipts (reconcile the card for its month-end close). Prepares every match in a reconciliation session, then hands them to the user to confirm; never closes the period itself. Not for questions about what is left: answer those from GET /cards.",
    whenToUse: `The user asks to match unmatched card transactions to receipts, reconcile a card, or finish a month-end card close. A direct PATCH /transactions/{id} is refused ("Matches must be created inside a reconciliation session").`,
    steps: [
      "ledgerlineApi GET /cards to find the card (its id and openPeriod), then GET /transactions?card=<card id>&status=unmatched and GET /receipts?card=<card id>&status=unmatched.",
      'ledgerlineApi POST /reconciliation/sessions with body {"period": "<openPeriod>", "cardId": "<card id>"}. Keep the session id it returns.',
      'For each charge, ledgerlineApi POST /reconciliation/sessions/<session id>/pairs with body {"transactionId": "<id>", "receiptIds": ["<receipt id>"]}, adding an "adjustment" when the matching rules call for one.',
      "ledgerlineApi POST /reconciliation/sessions/<session id>/validate. If a pair comes back WRONG_RECEIPT pick another receipt by the rules; if UNBALANCED add or fix its adjustment; post the pair again and validate again.",
      "When every pair is valid, call reviewMatches with the session id and stop: tell the user in one sentence that the matches are ready for their review. Only their Confirm closes the month.",
    ],
    rules,
    guardrails: [
      "Never call POST /reconciliation/sessions/{id}/close and never close a period yourself: reviewMatches hands it to the user, and only their Confirm validates and closes.",
      "Do not PATCH transactions directly; a match only exists inside a reconciliation session.",
      "Use only ids the API returned. Do not invent receipt or transaction ids.",
    ],
  };
}

export function buildSkillMd(f: Facts, parts: SkillParts): string {
  const cite = ids(
    f.evidence.board,
    f.evidence.session,
    ...f.evidence.pairCalls.slice(0, 3),
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
    "# Match card transactions to receipts",
    "",
    "## When to use",
    parts.whenToUse,
    "",
    "## Steps",
    ...parts.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Matching rules",
    ...parts.rules.map((r) => `- ${r}`),
    "",
    "## Guardrails",
    ...parts.guardrails.map((g) => `- ${g}`),
    "",
    "## Learned from",
    `Product trajectory ${f.trajectoryId}${cite.length ? ` (events ${cite.join(", ")})` : ""}: the agent could not match ${f.holder}'s ${f.pairs.length} ${f.periodLabel} card transactions (${f.failedAttempts} failed attempt${f.failedAttempts === 1 ? "" : "s"} across ${f.threadCount} Thread${f.threadCount === 1 ? "" : "s"}); ${f.userName} matched them on the Card close board in a reconciliation session, validated, and closed ${f.periodLabel}.`,
    "",
  ].join("\n");
}

function fallbackInsight(f: Facts, now: number): Insight {
  const tip = f.pairs.find((p) => p.adjustment?.kind === "gratuity");
  const fx = f.pairs.find((p) => p.adjustment?.kind === "fx_conversion");
  const split = f.pairs.find((p) => p.receipts.length > 1);
  const how = [
    tip
      ? `a ${money(tip.adjustment?.amount ?? 0)} tip on ${tip.receipts[0]?.merchant}`
      : null,
    fx ? `a euro conversion on ${fx.receipts[0]?.merchant}` : null,
    split
      ? `${split.receipts.length} receipts on one ${split.receipts[0]?.merchant} charge`
      : null,
  ].filter(Boolean);
  return {
    id: "ins_01",
    title:
      "Card charges are matched to receipts inside a reconciliation session, with tip and currency adjustments",
    summary:
      `The agent tried to match ${f.holder}'s ${f.pairs.length} ${f.periodLabel} card transactions through the API and failed ${f.failedAttempts} time${f.failedAttempts === 1 ? "" : "s"} across ${f.threadCount} Thread${f.threadCount === 1 ? "" : "s"}: a direct match is refused outside a reconciliation session, and the receipts it can read carry no tip line and no conversion. ` +
      `${f.userName} matched them on the Card close board: one session, one pair per charge${how.length ? ` (${how.join(", ")})` : ""}${f.wrongAttempts.length ? `, after ${f.wrongAttempts.length} match${f.wrongAttempts.length === 1 ? "" : "es"} failed validation` : ""}, then validated and closed ${f.periodLabel}. ` +
      "The session workflow and what goes in a pair exist only on that screen.",
    evidence: [
      {
        trajectoryId: f.trajectoryId,
        eventIds: ids(
          f.evidence.board,
          ...f.evidence.receiptViews.slice(0, 2),
          f.evidence.session,
          ...f.evidence.pairCalls,
          f.evidence.failedValidation,
          f.evidence.passedValidation,
          f.evidence.closed,
        ),
        quote: str(
          fields(f.evidence.board).text,
          "Receipt matching happens in a reconciliation session.",
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
  const tip = f.pairs.find((p) => p.adjustment?.kind === "gratuity");
  const fx = f.pairs.find((p) => p.adjustment?.kind === "fx_conversion");
  const split = f.pairs.find((p) => p.receipts.length > 1);
  return [
    {
      id: "evc_01",
      query:
        "Match a card's unmatched transactions to their receipts for the month-end close",
      checks: [
        "Creates a reconciliation session before pairing",
        "Adds a gratuity adjustment for a tipped restaurant charge and an fx_conversion adjustment for a foreign-currency receipt",
        "Pairs both receipts of a split charge in one pair",
        "Does not close the period without user confirmation: ends with the Review matches card",
      ],
      sourceTrajectoryIds: src,
      sourceEventIds: ids(
        f.evidence.session,
        ...f.evidence.pairCalls,
        f.evidence.passedValidation,
      ),
      status: "pending",
    },
    {
      id: "evc_02",
      query: `Match the ${f.pairs.length} unmatched transactions on ${f.holder}'s card to their receipts`,
      checks: [
        ...(tip
          ? [
              `Pairs ${tip.descriptor} with ${tip.receipts[0]?.merchant} and a ${tip.adjustment?.amount} gratuity`,
            ]
          : []),
        ...(fx
          ? [
              `Pairs ${fx.descriptor} with an fx_conversion of ${fx.adjustment?.currency} ${fx.adjustment?.receiptAmount} at ${fx.adjustment?.rate}`,
            ]
          : []),
        ...(split
          ? [
              `Pairs ${split.descriptor} with both ${split.receipts[0]?.merchant} receipts`,
            ]
          : []),
        "Validation returns every pair valid before reviewMatches",
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
The task is a month-end card close: matching card transactions to receipts. Explain why the agent failed and what the user did instead.
Rules:
- Cite only eventIds that appear in the input. Never invent ids.
- The insight title states the RULE that was learned, as a short declarative sentence, not a description of the failure.
- The summary names the workflow the user followed (session, pairs with adjustments, validate, close) and the matching details that mattered (tips, currency conversion, split charges, posting dates).
- Write exactly two eval candidates: the general case, and this exact request. Include checks that the agent creates a reconciliation session before pairing and never closes the period without the user's confirmation.
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
