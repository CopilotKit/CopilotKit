/**
 * The month-end card close. SERVER-ONLY. In memory, pinned on `globalThis`,
 * reset with the expense ledger.
 *
 * A close is a SESSION for a card and period. Opening one auto-matches every
 * receipt charge (tips, euros and two-receipt splits included), the way a
 * modern spend platform does. What is left are the card's EXCEPTIONS, and each
 * is cleared through its own workflow, not by editing the charge:
 *
 * - split:            POST /allocations -> PUT /allocations/{id}/lines -> POST /allocations/{id}/commit
 * - reclass:          POST /journal/reclasses (September coding is soft-locked)
 * - personal:         POST /repayments
 * - missing receipt:  POST /affidavits
 *
 * Validate the session, then close. Validation answers per charge with a code
 * only; how an exception is cleared is described nowhere the agent can read.
 * Resolutions are kept per origin: an agent's attempt never pre-clears the
 * person's board.
 */

import { LedgerError } from "./store";
import {
  CARDS,
  DEPARTMENTS,
  EVENTS,
  GL_ACCOUNTS,
  RECEIPTS,
  TRANSACTIONS,
  attendeeSplit,
} from "./recon-seed";
import type { CardTransaction, Receipt } from "./recon-seed";

/** The answer key: which receipts settle each receipt charge, and how. */
const TRUTH: Record<
  string,
  {
    receiptIds: string[];
    adjustment?:
      | { kind: "gratuity"; amount: number }
      | {
          kind: "fx_conversion";
          currency: "EUR";
          receiptAmount: number;
          rate: number;
        };
  }
> = {
  txn_4417_0908: { receiptIds: ["rcpt_bb_0907"] },
  txn_4417_0912: {
    receiptIds: ["rcpt_nopa_0912"],
    adjustment: { kind: "gratuity", amount: 24.8 },
  },
  txn_4417_0915: { receiptIds: ["rcpt_amzn_0914"] },
  txn_4417_0918: {
    receiptIds: ["rcpt_marais_0917"],
    adjustment: {
      kind: "fx_conversion",
      currency: "EUR",
      receiptAmount: 372,
      rate: 1.1086,
    },
  },
  txn_4417_0922: { receiptIds: ["rcpt_ua_tkt_0920", "rcpt_ua_plus_0920"] },
  txn_4417_0925: { receiptIds: ["rcpt_wework_0925"] },
  txn_8820_0904: { receiptIds: ["rcpt_sight_0903"] },
  txn_8820_0910: {
    receiptIds: ["rcpt_zuni_0910"],
    adjustment: { kind: "gratuity", amount: 16 },
  },
  txn_8820_0916: { receiptIds: ["rcpt_amzn_0915"] },
  txn_8820_0921: {
    receiptIds: ["rcpt_iberia_0920"],
    adjustment: {
      kind: "fx_conversion",
      currency: "EUR",
      receiptAmount: 287,
      rate: 1.1101,
    },
  },
  txn_8820_0927: { receiptIds: ["rcpt_costco_0926a", "rcpt_costco_0926b"] },
  txn_3391_0905: { receiptIds: ["rcpt_ritual_0904"] },
  txn_3391_0911: {
    receiptIds: ["rcpt_flour_0911"],
    adjustment: { kind: "gratuity", amount: 22 },
  },
  txn_3391_0914: { receiptIds: ["rcpt_amzn_0913"] },
  txn_3391_0920: {
    receiptIds: ["rcpt_tap_0919"],
    adjustment: {
      kind: "fx_conversion",
      currency: "EUR",
      receiptAmount: 440,
      rate: 1.1085,
    },
  },
  txn_3391_0925: { receiptIds: ["rcpt_staples_0924a", "rcpt_staples_0924b"] },
};

export interface Adjustment {
  kind: string;
  amount?: number;
  currency?: string;
  receiptAmount?: number;
  rate?: number;
}

export interface Pair {
  transactionId: string;
  receiptIds: string[];
  adjustment?: Adjustment;
  note?: string;
  /** Matched by Ledgerline when the session opened. */
  auto?: boolean;
}

export type Resolution =
  | {
      kind: "split";
      allocationId: string;
      lines: { departmentId: string; amount: number }[];
    }
  | {
      kind: "reclass";
      entryId: string;
      fromAccount: string;
      toAccount: string;
      memo: string;
    }
  | {
      kind: "personal";
      repaymentId: string;
      method: "payroll_deduction" | "card_payment";
    }
  | {
      kind: "missing_receipt";
      affidavitId: string;
      memo: string;
      attestedBy: string;
      attestedAt: string;
    };

export type PairCode =
  | "WRONG_RECEIPT"
  | "UNBALANCED"
  | "UNMATCHED"
  | "UNRESOLVED"
  | "WRONG_ACCOUNT"
  | "WRONG_SPLIT";

export interface PairResult {
  transactionId: string;
  valid: boolean;
  code?: PairCode;
}

export type Origin = "board" | "api";

export interface ReconSession {
  id: string;
  /** Who opened it: the Card close board, or the integration API (an agent). */
  origin: Origin;
  cardId: string;
  period: string;
  status: "open" | "closed";
  transactionIds: string[];
  pairs: Record<string, Pair>;
  revision: number;
  validated: { revision: number; valid: number; total: number } | null;
  createdAt: string;
  closedAt?: string;
}

interface Allocation {
  id: string;
  origin: Origin;
  transactionId: string;
  status: "draft" | "committed";
  lines: { departmentId: string; amount: number }[];
}

interface ReconState {
  sessions: Record<string, ReconSession>;
  counter: number;
  /** transactionId -> its committed pair, once a period is closed. */
  matched: Record<string, Pair>;
  /** transactionId -> how its exception was cleared, once a period is closed. */
  cleared: Record<string, Resolution>;
  closed: Record<string, string>; // `${cardId}:${period}` -> closedAt
  allocations: Record<string, Allocation>;
  /** Per origin, transactionId -> its resolution while the period is open. */
  resolutions: Record<Origin, Record<string, Resolution>>;
}

const KEY = Symbol.for("ledgerline.recon.v2");
type Pinned = typeof globalThis & { [KEY]?: ReconState };

const fresh = (): ReconState => ({
  sessions: {},
  counter: 1,
  matched: {},
  cleared: {},
  closed: {},
  allocations: {},
  resolutions: { board: {}, api: {} },
});

function state(): ReconState {
  const g = globalThis as Pinned;
  g[KEY] ??= fresh();
  return g[KEY]!;
}

export function reset(): void {
  (globalThis as Pinned)[KEY] = fresh();
}

const clone = <T>(v: T): T => structuredClone(v);
const cents = (n: number) => Math.round(n * 100);
/** Ids that read like the ledger's own: JE-4102, AL-4103, RP-4104, AF-4105. */
const nextId = (prefix: string) =>
  `${prefix.toUpperCase()}-${4100 + state().counter++}`;

/** The canonical close of a card, as the learning step reads it (the skill's ground truth). */
export function canonicalPairs(cardId: string) {
  return TRANSACTIONS.filter((t) => t.cardId === cardId && !t.exception).map(
    (t) => ({
      transactionId: t.id,
      descriptor: t.descriptor,
      amount: t.amount,
      postedAt: t.postedAt,
      receipts: TRUTH[t.id]!.receiptIds.map(
        (id) => RECEIPTS.find((r) => r.id === id)!,
      ),
      adjustment: TRUTH[t.id]!.adjustment,
    }),
  );
}

/** The card's exceptions and how each is correctly cleared. */
export function canonicalExceptions(cardId: string) {
  return TRANSACTIONS.filter((t) => t.cardId === cardId && t.exception).map(
    (t) => ({
      transactionId: t.id,
      descriptor: t.descriptor,
      amount: t.amount,
      exception: t.exception!,
      expected: expectedResolution(t),
    }),
  );
}

function expectedResolution(t: CardTransaction) {
  const x = t.exception!;
  if (x.kind === "split") {
    const ev = EVENTS.find((e) => e.id === x.eventId)!;
    return { kind: "split" as const, lines: attendeeSplit(t.amount, ev) };
  }
  if (x.kind === "reclass")
    return {
      kind: "reclass" as const,
      fromAccount: t.glAccount,
      toAccount: x.suggestedAccount,
    };
  if (x.kind === "personal")
    return { kind: "personal" as const, method: "payroll_deduction" as const };
  return { kind: "missing_receipt" as const };
}

function card(cardId: unknown) {
  const c = CARDS.find((x) => x.id === cardId || x.last4 === cardId);
  if (!c)
    throw new LedgerError("NOT_FOUND", `There is no card ${String(cardId)}.`);
  return c;
}

const isClosed = (t: CardTransaction) => {
  const c = CARDS.find((x) => x.id === t.cardId)!;
  return !!state().closed[`${c.id}:${c.period}`];
};

export function cards() {
  return CARDS.map((c) => ({
    ...c,
    /** Exceptions still waiting for a person, while the month is open. */
    attention: closedFor(c.id)
      ? 0
      : TRANSACTIONS.filter(
          (t) =>
            t.cardId === c.id &&
            t.exception &&
            !state().resolutions.board[t.id],
        ).length,
    open: openTransactions(c.id).length,
    closed: closedFor(c.id),
  }));
}

const closedFor = (cardId: string) => {
  const c = card(cardId);
  return !!state().closed[`${c.id}:${c.period}`];
};

/** The card's charges that are not closed yet. */
export function openTransactions(cardId?: string): CardTransaction[] {
  return TRANSACTIONS.filter(
    (t) => (!cardId || t.cardId === cardId) && !isClosed(t),
  );
}

export function transaction(id: string): CardTransaction {
  const t = TRANSACTIONS.find((x) => x.id === id);
  if (!t) throw new LedgerError("NOT_FOUND", `There is no transaction ${id}.`);
  return t;
}

/** Receipts Ledgerline auto-matches when a close opens. */
const AUTO_RECEIPTS = new Set(
  Object.values(TRUTH).flatMap((t) => t.receiptIds),
);

export function receipts(cardId?: string): (Receipt & { matched: boolean })[] {
  const used = new Set([
    ...Object.values(state().matched).flatMap((p) => p.receiptIds),
    ...AUTO_RECEIPTS,
  ]);
  return RECEIPTS.filter((r) => !cardId || r.cardId === cardId).map((r) => ({
    ...r,
    matched: used.has(r.id),
  }));
}

/** The receipt charges' auto-matches, as Ledgerline makes them when a session opens. */
function autoPairs(transactionIds: string[]): Record<string, Pair> {
  const out: Record<string, Pair> = {};
  for (const id of transactionIds) {
    const truth = TRUTH[id];
    if (!truth) continue;
    out[id] = {
      transactionId: id,
      receiptIds: [...truth.receiptIds],
      ...(truth.adjustment ? { adjustment: { ...truth.adjustment } } : {}),
      auto: true,
    };
  }
  return out;
}

export function resolutionsFor(origin: Origin, cardId: string) {
  const r = state().resolutions[origin];
  return Object.fromEntries(
    TRANSACTIONS.filter((t) => t.cardId === cardId && r[t.id]).map((t) => [
      t.id,
      clone(r[t.id]!),
    ]),
  ) as Record<string, Resolution>;
}

/**
 * A card's close at a glance, as one origin sees it: the agent's status card
 * (`showCloseStatus`) draws this. Receipt charges are auto-matched; each
 * exception is waiting for a person, or cleared (by this origin, or by the
 * close itself).
 */
export function closeStatus(cardId: string, origin: Origin | "all") {
  const c = card(cardId);
  const s = state();
  const closedAt = s.closed[`${c.id}:${c.period}`] ?? null;
  const own =
    origin === "all"
      ? { ...s.resolutions.board, ...s.resolutions.api }
      : s.resolutions[origin];
  const txns = TRANSACTIONS.filter((t) => t.cardId === c.id);
  const auto = txns.filter((t) => !t.exception);
  const notes: string[] = [];
  for (const t of auto) {
    const truth = TRUTH[t.id];
    const a = truth?.adjustment;
    if (a?.kind === "gratuity") notes.push(`Tip $${a.amount.toFixed(2)}`);
    if (a?.kind === "fx_conversion")
      notes.push(`€${a.receiptAmount.toFixed(2)} at ${a.rate.toFixed(4)}`);
    if (truth && truth.receiptIds.length > 1)
      notes.push(`Split · ${truth.receiptIds.length} receipts`);
  }
  const exceptions = txns
    .filter((t) => t.exception)
    .map((t) => {
      const r = s.cleared[t.id] ?? own[t.id] ?? null;
      return {
        transactionId: t.id,
        descriptor: t.descriptor,
        amount: t.amount,
        kind: t.exception!.kind,
        status: r ? ("cleared" as const) : ("needs_you" as const),
        resolution: r ? clone(r) : null,
      };
    });
  return {
    card: {
      id: c.id,
      holder: c.holder,
      last4: c.last4,
      period: c.period,
      periodLabel: c.periodLabel,
    },
    closed: !!closedAt,
    closedAt,
    total: txns.length,
    totalAmount: Math.round(txns.reduce((n, t) => n + t.amount, 0) * 100) / 100,
    autoMatched: {
      count: auto.length,
      amount: Math.round(auto.reduce((n, t) => n + t.amount, 0) * 100) / 100,
      notes,
    },
    exceptions,
    ready:
      auto.length + exceptions.filter((x) => x.status === "cleared").length,
  };
}

/** The board's view for one card: its open session if any, and what is settled. */
export function board(cardId: string) {
  const c = card(cardId);
  const s = state();
  // The board resumes only its own session: an agent's attempt never pre-fills it.
  const session = Object.values(s.sessions).find(
    (x) =>
      x.cardId === c.id &&
      x.period === c.period &&
      x.status === "open" &&
      x.origin === "board",
  );
  return {
    card: c,
    closedAt: s.closed[`${c.id}:${c.period}`] ?? null,
    transactions: TRANSACTIONS.filter((t) => t.cardId === c.id).map((t) => ({
      ...t,
      match: s.matched[t.id] ? clone(s.matched[t.id]!) : null,
      resolution: s.cleared[t.id]
        ? clone(s.cleared[t.id]!)
        : s.resolutions.board[t.id]
          ? clone(s.resolutions.board[t.id]!)
          : null,
    })),
    receipts: receipts(c.id),
    session: session ? clone(session) : null,
    events: EVENTS,
    departments: DEPARTMENTS,
    glAccounts: GL_ACCOUNTS,
  };
}

/**
 * Editing a charge directly is refused. Each refusal names the rule, never the
 * workflow that would clear it: that is what a person knows from the board.
 */
export function patchTransaction(
  id: string,
  body: Record<string, unknown> = {},
): never {
  const t = transaction(id);
  const keys = Object.keys(body).map((k) => k.toLowerCase());
  const kind = t.exception?.kind;
  // The body's own fields first, else whatever this charge's exception is.
  const has = (exception: string, ...words: string[]) =>
    keys.some((k) => words.some((w) => k.includes(w))) ||
    (kind === exception &&
      !keys.some((k) =>
        /gl|account|coding|category|department|alloc|split|personal|repay|receipt|waive|affidavit/.test(
          k,
        ),
      ));
  if (has("reclass", "gl", "account", "coding", "category"))
    throw new LedgerError(
      "PERIOD_SOFT_LOCKED",
      `${card(t.cardId).periodLabel} coding is locked for the preliminary close.`,
    );
  if (has("split", "department", "alloc", "split", "costcenter", "cost_center"))
    throw new LedgerError(
      "ALLOCATION_REQUIRED",
      "A charge shared across departments is an allocation, not a field on the charge.",
    );
  if (has("personal", "personal", "reimburs", "repay", "business"))
    throw new LedgerError(
      "NOT_EDITABLE",
      "Whether a charge is personal is not a field on the charge.",
    );
  if (has("missing_receipt", "receipt", "waive", "affidavit", "missing"))
    throw new LedgerError(
      "RECEIPT_REQUIRED",
      "Every card charge needs a receipt on file.",
    );
  throw new LedgerError(
    "SESSION_REQUIRED",
    "Charges are matched inside a reconciliation session.",
  );
}

function findSession(id: unknown): ReconSession {
  if (typeof id !== "string" || !id.trim())
    throw new LedgerError("BAD_REQUEST", "sessionId is required.");
  const s = state().sessions[id.trim()];
  if (!s)
    throw new LedgerError("SESSION_NOT_FOUND", `There is no session ${id}.`);
  return s;
}

export function createSession(
  body: { period?: unknown; cardId?: unknown },
  origin: Origin = "board",
): ReconSession {
  if (typeof body.period !== "string" || !/^\d{4}-\d{2}$/.test(body.period))
    throw new LedgerError("BAD_REQUEST", "period is required, as YYYY-MM.");
  if (body.cardId === undefined)
    throw new LedgerError("BAD_REQUEST", "cardId is required.");
  const c = card(body.cardId);
  if (c.period !== body.period)
    throw new LedgerError(
      "PERIOD_NOT_OPEN",
      `${body.period} is not an open period for ${c.id}.`,
    );
  const st = state();
  if (st.closed[`${c.id}:${c.period}`])
    throw new LedgerError(
      "PERIOD_CLOSED",
      `${c.periodLabel} is already closed for ${c.id}.`,
    );
  const existing = Object.values(st.sessions).find(
    (x) =>
      x.cardId === c.id &&
      x.period === c.period &&
      x.status === "open" &&
      x.origin === origin,
  );
  if (existing) return clone(existing);
  const ids = openTransactions(c.id).map((t) => t.id);
  const session: ReconSession = {
    id: `rs_${c.last4}_${c.period.slice(5)}_${String(st.counter++).padStart(3, "0")}`,
    origin,
    cardId: c.id,
    period: c.period,
    status: "open",
    transactionIds: ids,
    pairs: autoPairs(ids),
    revision: 1,
    validated: null,
    createdAt: new Date().toISOString(),
  };
  st.sessions[session.id] = session;
  return clone(session);
}

export function getSession(id: unknown): ReconSession {
  return clone(findSession(id));
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** Add or replace the receipt pair for one charge. */
export function putPair(
  sessionId: unknown,
  body: Record<string, unknown>,
): ReconSession {
  const s = findSession(sessionId);
  if (s.status !== "open")
    throw new LedgerError("SESSION_CLOSED", `${s.id} is closed.`);
  const transactionId = String(body.transactionId ?? "").trim();
  if (!transactionId)
    throw new LedgerError("BAD_REQUEST", "transactionId is required.");
  if (!s.transactionIds.includes(transactionId))
    throw new LedgerError(
      "INVALID_TRANSACTION",
      `${transactionId} is not in ${s.id}.`,
    );
  if (transaction(transactionId).exception)
    throw new LedgerError(
      "EXCEPTION_OPEN",
      `${transactionId} needs attention before it can be matched.`,
    );
  if (!Array.isArray(body.receiptIds) || body.receiptIds.length === 0)
    throw new LedgerError(
      "BAD_REQUEST",
      "receiptIds must be a non-empty array.",
    );
  const ids = body.receiptIds.map((x) => String(x).trim());
  const known = new Set(receipts(s.cardId).map((r) => r.id));
  const unknown = ids.find((x) => !known.has(x));
  if (unknown)
    throw new LedgerError(
      "INVALID_RECEIPT",
      `${unknown} is not in this card's receipts.`,
    );
  const a = body.adjustment as Record<string, unknown> | undefined;
  const adjustment: Adjustment | undefined =
    a && typeof a === "object" && typeof a.kind === "string"
      ? {
          kind: a.kind,
          amount: num(a.amount),
          currency:
            typeof a.currency === "string"
              ? a.currency.toUpperCase()
              : undefined,
          receiptAmount: num(a.receiptAmount),
          rate: num(a.rate),
        }
      : undefined;
  s.pairs[transactionId] = {
    transactionId,
    receiptIds: ids,
    ...(adjustment ? { adjustment } : {}),
    ...(typeof body.note === "string" && body.note.trim()
      ? { note: body.note.trim().slice(0, 200) }
      : {}),
  };
  s.revision += 1;
  return clone(s);
}

export function deletePair(
  sessionId: unknown,
  transactionId: string,
): ReconSession {
  const s = findSession(sessionId);
  if (s.status !== "open")
    throw new LedgerError("SESSION_CLOSED", `${s.id} is closed.`);
  if (s.pairs[transactionId]) {
    delete s.pairs[transactionId];
    s.revision += 1;
  }
  return clone(s);
}

// ── Exception workflows ──────────────────────────────────────────────────

/** The charge an exception workflow acts on: must exist, be open, and have that exception. */
function exceptionCharge(body: Record<string, unknown>, kind: string) {
  const id = String(body.transactionId ?? "").trim();
  if (!id) throw new LedgerError("BAD_REQUEST", "transactionId is required.");
  const t = transaction(id);
  if (isClosed(t))
    throw new LedgerError(
      "PERIOD_CLOSED",
      `${card(t.cardId).periodLabel} is already closed for ${t.cardId}.`,
    );
  if (t.exception?.kind !== kind)
    throw new LedgerError("NOT_APPLICABLE", `${id} does not take this action.`);
  return t;
}

/** A change to an exception means the session needs a fresh validation. */
function touch(cardId: string, origin: Origin) {
  for (const s of Object.values(state().sessions))
    if (s.cardId === cardId && s.origin === origin && s.status === "open")
      s.revision += 1;
}

export function event(id: string) {
  const ev = EVENTS.find((e) => e.id === id);
  if (!ev) throw new LedgerError("NOT_FOUND", `There is no event ${id}.`);
  return clone(ev);
}

export function createAllocation(
  body: Record<string, unknown>,
  origin: Origin,
) {
  const t = exceptionCharge(body, "split");
  const a: Allocation = {
    id: nextId("al"),
    origin,
    transactionId: t.id,
    status: "draft",
    lines: [],
  };
  state().allocations[a.id] = a;
  return clone(a);
}

function findAllocation(id: string, origin: Origin) {
  const a = state().allocations[id];
  if (!a || a.origin !== origin)
    throw new LedgerError("NOT_FOUND", `There is no allocation ${id}.`);
  return a;
}

export function setAllocationLines(
  id: string,
  body: Record<string, unknown>,
  origin: Origin,
) {
  const a = findAllocation(id, origin);
  if (a.status !== "draft")
    throw new LedgerError(
      "ALLOCATION_COMMITTED",
      `${id} is already committed.`,
    );
  if (!Array.isArray(body.lines) || body.lines.length === 0)
    throw new LedgerError("BAD_REQUEST", "Invalid allocation lines.");
  const lines = body.lines.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    const dept = String(o.departmentId ?? "").trim();
    const amount = num(o.amount);
    if (!DEPARTMENTS.some((d) => d.id === dept) || amount === undefined)
      throw new LedgerError("BAD_REQUEST", "Invalid allocation lines.");
    return { departmentId: dept, amount };
  });
  const t = transaction(a.transactionId);
  if (cents(lines.reduce((n, l) => n + l.amount, 0)) !== cents(t.amount))
    throw new LedgerError(
      "ALLOCATION_UNBALANCED",
      "The allocation lines do not add up to the charge.",
    );
  a.lines = lines;
  return clone(a);
}

export function commitAllocation(id: string, origin: Origin) {
  const a = findAllocation(id, origin);
  if (!a.lines.length)
    throw new LedgerError("ALLOCATION_EMPTY", `${id} has no lines yet.`);
  a.status = "committed";
  const t = transaction(a.transactionId);
  state().resolutions[origin][t.id] = {
    kind: "split",
    allocationId: a.id,
    lines: clone(a.lines),
  };
  touch(t.cardId, origin);
  return clone(a);
}

export function createReclass(body: Record<string, unknown>, origin: Origin) {
  const t = exceptionCharge(body, "reclass");
  const from = String(body.fromAccount ?? "").trim();
  const to = String(body.toAccount ?? "").trim();
  const memo = String(body.memo ?? "").trim();
  if (from !== t.glAccount)
    throw new LedgerError(
      "ACCOUNT_MISMATCH",
      "fromAccount is not the account this charge is coded to.",
    );
  if (!GL_ACCOUNTS.some((g) => g.code === to) || to === from || !memo)
    throw new LedgerError("BAD_REQUEST", "Invalid reclass entry.");
  const entry = {
    kind: "reclass" as const,
    entryId: nextId("je"),
    fromAccount: from,
    toAccount: to,
    memo: memo.slice(0, 200),
  };
  state().resolutions[origin][t.id] = entry;
  touch(t.cardId, origin);
  return { ...entry, transactionId: t.id, status: "posted" };
}

export function createRepayment(body: Record<string, unknown>, origin: Origin) {
  const t = exceptionCharge(body, "personal");
  const method = String(body.method ?? "").trim();
  if (method !== "payroll_deduction" && method !== "card_payment")
    throw new LedgerError("BAD_REQUEST", "Invalid repayment method.");
  const r = {
    kind: "personal" as const,
    repaymentId: nextId("rp"),
    method: method as "payroll_deduction" | "card_payment",
  };
  state().resolutions[origin][t.id] = r;
  touch(t.cardId, origin);
  return { ...r, transactionId: t.id, amount: t.amount, status: "scheduled" };
}

export function createAffidavit(body: Record<string, unknown>, origin: Origin) {
  const t = exceptionCharge(body, "missing_receipt");
  const memo = String(body.memo ?? "").trim();
  if (memo.length < 12)
    throw new LedgerError(
      "BAD_REQUEST",
      "An affidavit needs the business purpose.",
    );
  // The request goes to the cardholder, who attests in the app. In the demo the
  // cardholder answers at once.
  const r = {
    kind: "missing_receipt" as const,
    affidavitId: nextId("af"),
    memo: memo.slice(0, 280),
    attestedBy: card(t.cardId).holder,
    attestedAt: new Date().toISOString(),
  };
  state().resolutions[origin][t.id] = r;
  touch(t.cardId, origin);
  return { ...r, transactionId: t.id, status: "attested" };
}

// ── Validate and close ───────────────────────────────────────────────────

function judgeException(t: CardTransaction, origin: Origin): PairResult {
  const r = state().resolutions[origin][t.id];
  const want = expectedResolution(t);
  if (!r || r.kind !== want.kind)
    return { transactionId: t.id, valid: false, code: "UNRESOLVED" };
  if (r.kind === "reclass" && want.kind === "reclass")
    return r.toAccount === want.toAccount
      ? { transactionId: t.id, valid: true }
      : { transactionId: t.id, valid: false, code: "WRONG_ACCOUNT" };
  if (r.kind === "split" && want.kind === "split") {
    const ok =
      want.lines.length === r.lines.length &&
      want.lines.every((w) =>
        r.lines.some(
          (l) =>
            l.departmentId === w.departmentId &&
            Math.abs(cents(l.amount) - cents(w.amount)) <= 1,
        ),
      );
    return ok
      ? { transactionId: t.id, valid: true }
      : { transactionId: t.id, valid: false, code: "WRONG_SPLIT" };
  }
  return { transactionId: t.id, valid: true };
}

function judge(s: ReconSession, transactionId: string): PairResult {
  const t = transaction(transactionId);
  if (t.exception) return judgeException(t, s.origin);
  const pair = s.pairs[transactionId];
  if (!pair) return { transactionId, valid: false, code: "UNMATCHED" };
  const truth = TRUTH[transactionId];
  const same =
    !!truth &&
    truth.receiptIds.length === pair.receiptIds.length &&
    truth.receiptIds.every((r) => pair.receiptIds.includes(r));
  if (!same) return { transactionId, valid: false, code: "WRONG_RECEIPT" };
  // The pair must balance: receipts (converted) plus the adjustment = the charge.
  const rs = RECEIPTS.filter((r) => pair.receiptIds.includes(r.id));
  const adj = pair.adjustment;
  let settled: number;
  if (rs.some((r) => r.currency !== "USD")) {
    if (
      adj?.kind !== "fx_conversion" ||
      adj.currency !== rs[0]!.currency ||
      adj.rate === undefined ||
      cents(adj.receiptAmount ?? -1) !==
        cents(rs.reduce((n, r) => n + r.total, 0))
    )
      return { transactionId, valid: false, code: "UNBALANCED" };
    settled = (adj.receiptAmount ?? 0) * adj.rate;
  } else {
    settled = rs.reduce((n, r) => n + r.total, 0);
    if (adj?.kind === "gratuity") settled += adj.amount ?? 0;
    else if (adj) return { transactionId, valid: false, code: "UNBALANCED" };
  }
  return Math.abs(cents(settled) - cents(t.amount)) <= 1
    ? { transactionId, valid: true }
    : { transactionId, valid: false, code: "UNBALANCED" };
}

export function validate(sessionId: unknown) {
  const s = findSession(sessionId);
  const results = s.transactionIds.map((id) => judge(s, id));
  const valid = results.filter((r) => r.valid).length;
  s.validated = { revision: s.revision, valid, total: results.length };
  return { sessionId: s.id, valid, total: results.length, results };
}

/** Close the period. Only a session whose CURRENT state all validated can close. */
export function close(sessionId: unknown) {
  const s = findSession(sessionId);
  if (s.status !== "open")
    throw new LedgerError("SESSION_CLOSED", `${s.id} is already closed.`);
  if (
    !s.validated ||
    s.validated.revision !== s.revision ||
    s.validated.valid !== s.validated.total
  )
    throw new LedgerError(
      "VALIDATION_REQUIRED",
      "Every charge must pass validation before the period can close.",
    );
  const st = state();
  for (const p of Object.values(s.pairs))
    st.matched[p.transactionId] = clone(p);
  for (const id of s.transactionIds) {
    const r = st.resolutions[s.origin][id];
    if (r) st.cleared[id] = clone(r);
  }
  s.status = "closed";
  s.closedAt = new Date().toISOString();
  // Any other open session for the same card and month is now moot.
  for (const other of Object.values(st.sessions))
    if (
      other !== s &&
      other.cardId === s.cardId &&
      other.period === s.period &&
      other.status === "open"
    )
      other.status = "closed";
  const c = card(s.cardId);
  st.closed[`${c.id}:${c.period}`] = s.closedAt;
  const exceptions = s.transactionIds.filter(
    (id) => transaction(id).exception,
  ).length;
  return {
    sessionId: s.id,
    cardId: c.id,
    period: c.period,
    closed: true,
    charges: s.transactionIds.length,
    matched: s.transactionIds.length - exceptions,
    exceptions,
  };
}
