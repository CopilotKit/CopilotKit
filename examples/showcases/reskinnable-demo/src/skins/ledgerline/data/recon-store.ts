/**
 * Reconciliation sessions for the month-end card close. SERVER-ONLY. In
 * memory, pinned on `globalThis`, reset with the expense ledger.
 *
 * The workflow is a session: open one for a card and period, add one PAIR per
 * card transaction (its receipts, plus an `adjustment` when the receipt total
 * differs from the charge: a handwritten gratuity, or a foreign-currency
 * conversion), validate the session, then close the period. A match cannot be
 * made outside a session.
 *
 * Validation answers per pair with a code only (`WRONG_RECEIPT`,
 * `UNBALANCED`, `UNMATCHED`). The Reconcile board explains a failure from what
 * the person can see on the receipts; this API never says what would balance.
 */

import { LedgerError } from "./store";
import { CARDS, RECEIPTS, TRANSACTIONS } from "./recon-seed";
import type { CardTransaction, Receipt } from "./recon-seed";

/** The answer key: which receipts settle each charge, and how. */
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
}

export interface PairResult {
  transactionId: string;
  valid: boolean;
  code?: "WRONG_RECEIPT" | "UNBALANCED" | "UNMATCHED";
}

export interface ReconSession {
  id: string;
  /** Who opened it: the Card close board, or the integration API (an agent). */
  origin: "board" | "api";
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

interface ReconState {
  sessions: Record<string, ReconSession>;
  counter: number;
  /** transactionId -> its committed pair, once a period is closed. */
  matched: Record<string, Pair>;
  closed: Record<string, string>; // `${cardId}:${period}` -> closedAt
}

const KEY = Symbol.for("ledgerline.recon.v1");
type Pinned = typeof globalThis & { [KEY]?: ReconState };

function state(): ReconState {
  const g = globalThis as Pinned;
  g[KEY] ??= { sessions: {}, counter: 1, matched: {}, closed: {} };
  return g[KEY]!;
}

/** Today's validated pairs for a card, as the learning step reads them (the canonical skill). */
export function canonicalPairs(cardId: string) {
  return TRANSACTIONS.filter((t) => t.cardId === cardId).map((t) => ({
    transactionId: t.id,
    descriptor: t.descriptor,
    amount: t.amount,
    postedAt: t.postedAt,
    receipts: TRUTH[t.id]!.receiptIds.map(
      (id) => RECEIPTS.find((r) => r.id === id)!,
    ),
    adjustment: TRUTH[t.id]!.adjustment,
  }));
}

export function reset(): void {
  (globalThis as Pinned)[KEY] = {
    sessions: {},
    counter: 1,
    matched: {},
    closed: {},
  };
}

const clone = <T>(v: T): T => structuredClone(v);
const cents = (n: number) => Math.round(n * 100);

function card(cardId: unknown) {
  const c = CARDS.find((x) => x.id === cardId || x.last4 === cardId);
  if (!c)
    throw new LedgerError("NOT_FOUND", `There is no card ${String(cardId)}.`);
  return c;
}

export function cards() {
  return CARDS.map((c) => ({
    ...c,
    unmatched: unmatchedTransactions(c.id).length,
    closed: !!state().closed[`${c.id}:${c.period}`],
  }));
}

export function unmatchedTransactions(cardId?: string): CardTransaction[] {
  const s = state();
  return TRANSACTIONS.filter(
    (t) => (!cardId || t.cardId === cardId) && !s.matched[t.id],
  );
}

export function transaction(id: string): CardTransaction {
  const t = TRANSACTIONS.find((x) => x.id === id);
  if (!t) throw new LedgerError("NOT_FOUND", `There is no transaction ${id}.`);
  return t;
}

export function receipts(cardId?: string): (Receipt & { matched: boolean })[] {
  const used = new Set(
    Object.values(state().matched).flatMap((p) => p.receiptIds),
  );
  return RECEIPTS.filter((r) => !cardId || r.cardId === cardId).map((r) => ({
    ...r,
    matched: used.has(r.id),
  }));
}

/** The board's view for one card: its open session if any, and the matches made. */
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
    })),
    receipts: receipts(c.id),
    session: session ? clone(session) : null,
  };
}

/** A direct match outside a session is refused: that is the workflow's first rule. */
export function patchTransaction(id: string): never {
  transaction(id);
  throw new LedgerError(
    "SESSION_REQUIRED",
    "Matches must be created inside a reconciliation session.",
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
  origin: ReconSession["origin"] = "board",
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
  const session: ReconSession = {
    id: `rs_${c.last4}_${c.period.slice(5)}_${String(st.counter++).padStart(3, "0")}`,
    origin,
    cardId: c.id,
    period: c.period,
    status: "open",
    transactionIds: unmatchedTransactions(c.id).map((t) => t.id),
    pairs: {},
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

/** Add or replace the pair for one transaction. */
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

function judge(s: ReconSession, transactionId: string): PairResult {
  const pair = s.pairs[transactionId];
  if (!pair) return { transactionId, valid: false, code: "UNMATCHED" };
  const truth = TRUTH[transactionId];
  const same =
    !!truth &&
    truth.receiptIds.length === pair.receiptIds.length &&
    truth.receiptIds.every((r) => pair.receiptIds.includes(r));
  if (!same) return { transactionId, valid: false, code: "WRONG_RECEIPT" };
  // The pair must balance: receipts (converted) plus the adjustment = the charge.
  const t = transaction(transactionId);
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

/** Close the period. Only a session whose CURRENT pairs all validated can close. */
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
      "Every pair must pass validation before the period can close.",
    );
  const st = state();
  for (const p of Object.values(s.pairs))
    st.matched[p.transactionId] = clone(p);
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
  return {
    sessionId: s.id,
    cardId: c.id,
    period: c.period,
    closed: true,
    matched: s.transactionIds.length,
  };
}
