/**
 * `ledgerlineApi`: the agent's generic tool over Ledgerline's integration API,
 * the same for the in-app agent and for ChatGPT over MCP. SERVER-ONLY.
 *
 * The agent gets a terse endpoint index and nothing else. Receipt charges
 * auto-match when a session opens; what is left are the card's exceptions,
 * and each is cleared through its own workflow (allocations, reclass entries,
 * repayments, affidavits). Those endpoints are NOT in the index, and editing
 * the charge is refused with the rule, never the workflow. That is what the
 * agent cannot work out and a product trajectory can teach. The Card close
 * board calls the same endpoints (origin "board").
 *
 * Closing a period is deliberately NOT reachable here: the agent hands the
 * matches over with `reviewMatches`, and only the person's Confirm closes.
 */

import * as store from "./store";
import { LedgerError } from "./store";
import * as recon from "./recon-store";
import { agentPolicies, agentReport, agentReportRow } from "./agent-view";
import type { ReportStatus } from "./types";
import { DEPARTMENTS, GL_ACCOUNTS } from "./recon-seed";
import type { CardTransaction } from "./recon-seed";

export { AGENT_API_INDEX, LEDGERLINE_API_DESCRIPTION } from "./agent-api-index";

export interface AgentApiResult {
  status: number;
  body: Record<string, unknown>;
}

const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  SESSION_REQUIRED: 409,
  SESSION_CLOSED: 409,
  PERIOD_NOT_OPEN: 409,
  PERIOD_CLOSED: 409,
  VALIDATION_REQUIRED: 409,
  INVALID_TRANSACTION: 422,
  INVALID_RECEIPT: 422,
  PERIOD_SOFT_LOCKED: 423,
  ALLOCATION_REQUIRED: 409,
  NOT_EDITABLE: 409,
  RECEIPT_REQUIRED: 409,
  EXCEPTION_OPEN: 409,
  NOT_APPLICABLE: 422,
  ACCOUNT_MISMATCH: 422,
  ALLOCATION_UNBALANCED: 422,
  ALLOCATION_COMMITTED: 409,
  ALLOCATION_EMPTY: 409,
  VALIDATION_FAILED: 409,
};

export const STATUS_FOR = (code: string) => STATUS[code] ?? 400;

const ok = (body: Record<string, unknown>, status = 200): AgentApiResult => ({
  status,
  body,
});
const fail = (
  status: number,
  error: string,
  message: string,
): AgentApiResult => ({ status, body: { error, message } });

function obj(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** A receipt as the API returns it: what was extracted, not the image. */
const receiptView = (r: ReturnType<typeof recon.receipts>[number]) => ({
  id: r.id,
  merchant: r.merchant,
  date: r.date,
  total: r.total,
  currency: r.currency,
  status: r.matched ? "matched" : "unmatched",
});

const sessionView = (s: recon.ReconSession) => ({
  id: s.id,
  cardId: s.cardId,
  period: s.period,
  status: s.status,
  transactionIds: s.transactionIds,
  pairs: Object.values(s.pairs),
});

const cardOf = (v: string | null) =>
  v ? recon.cards().find((c) => c.id === v || c.last4 === v) : undefined;

/** A charge as the list returns it: auto-matched, or needing attention. */
function chargeStatus(t: CardTransaction, origin: recon.Origin) {
  if (!t.exception) return "matched";
  return recon.resolutionsFor(origin, t.cardId)[t.id]
    ? "resolved"
    : "needs_attention";
}

export function agentApi(
  methodIn: string,
  pathIn: string,
  bodyIn?: unknown,
  origin: recon.Origin = "api",
): AgentApiResult {
  const method = methodIn.trim().toUpperCase();
  const url = new URL(
    pathIn
      .trim()
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/^\/?(api\/ledgerline\/v1)?/i, "/") || "/",
    "http://ledgerline.local",
  );
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const q = url.searchParams;
  const body = obj(bodyIn);
  const seg = path.split("/").filter(Boolean);
  const is = (m: string, pattern: RegExp) => method === m && pattern.test(path);

  try {
    if (is("GET", /^\/cards$/))
      return ok({
        cards: recon.cards().map((c) => ({
          id: c.id,
          holder: c.holder,
          last4: c.last4,
          openPeriod: c.closed ? null : c.period,
          openCharges: c.open,
          needsAttention: c.attention,
        })),
      });
    if (is("GET", /^\/transactions$/)) {
      const card = cardOf(q.get("card"));
      if (q.get("card") && !card)
        return fail(404, "NOT_FOUND", `There is no card ${q.get("card")}.`);
      const want = q.get("status");
      const rows = recon
        .openTransactions(card?.id)
        .map((t) => ({
          id: t.id,
          cardId: t.cardId,
          postedAt: t.postedAt,
          descriptor: t.descriptor,
          amount: t.amount,
          currency: "USD",
          status: chargeStatus(t, origin),
        }))
        .filter(
          (r) =>
            !want ||
            r.status === want ||
            (["unmatched", "open", "exception", "exceptions"].includes(want) &&
              r.status === "needs_attention"),
        );
      return ok({ count: rows.length, transactions: rows });
    }
    if (is("GET", /^\/transactions\/[^/]+$/)) {
      const t = recon.transaction(seg[1]!);
      const x = t.exception;
      return ok({
        id: t.id,
        cardId: t.cardId,
        postedAt: t.postedAt,
        descriptor: t.descriptor,
        amount: t.amount,
        currency: "USD",
        mcc: t.mcc,
        glAccount: t.glAccount,
        status: chargeStatus(t, origin),
        receiptStatus: x?.kind === "missing_receipt" ? "missing" : "on_file",
        ...(x?.kind === "split" ? { eventId: x.eventId } : {}),
        ...(x?.kind === "personal"
          ? { cardholderNote: { author: x.note.author, text: x.note.text } }
          : {}),
      });
    }
    if (is("PATCH", /^\/transactions\/[^/]+$/))
      recon.patchTransaction(seg[1]!, body);
    // Unlisted: the exception workflows the Card close board uses.
    if (is("GET", /^\/events\/[^/]+$/)) return ok({ ...recon.event(seg[1]!) });
    if (is("GET", /^\/gl-accounts$/)) return ok({ accounts: GL_ACCOUNTS });
    if (is("GET", /^\/departments$/)) return ok({ departments: DEPARTMENTS });
    if (is("POST", /^\/allocations$/))
      return ok({ ...recon.createAllocation(body, origin) }, 201);
    if (is("PUT", /^\/allocations\/[^/]+\/lines$/))
      return ok({ ...recon.setAllocationLines(seg[1]!, body, origin) });
    if (is("POST", /^\/allocations\/[^/]+\/commit$/))
      return ok({ ...recon.commitAllocation(seg[1]!, origin) });
    if (is("POST", /^\/journal\/reclasses$/))
      return ok(recon.createReclass(body, origin), 201);
    if (is("POST", /^\/repayments$/))
      return ok(recon.createRepayment(body, origin), 201);
    if (is("POST", /^\/affidavits$/))
      return ok(recon.createAffidavit(body, origin), 201);
    if (is("GET", /^\/receipts$/)) {
      const card = cardOf(q.get("card"));
      const status = q.get("status");
      const rows = recon
        .receipts(card?.id)
        .filter((r) => !status || (status === "unmatched") === !r.matched)
        .map(receiptView);
      return ok({ count: rows.length, receipts: rows });
    }
    if (is("GET", /^\/receipts\/[^/]+$/)) {
      const r = recon.receipts().find((x) => x.id === seg[1]);
      if (!r) return fail(404, "NOT_FOUND", `There is no receipt ${seg[1]}.`);
      return ok({ ...receiptView(r), image: `${r.id}.jpg` });
    }
    if (is("POST", /^\/reconciliation\/sessions$/))
      return ok(sessionView(recon.createSession(body, origin)), 201);
    if (is("GET", /^\/reconciliation\/sessions\/[^/]+$/))
      return ok(sessionView(recon.getSession(seg[2])));
    if (is("POST", /^\/reconciliation\/sessions\/[^/]+\/pairs$/))
      return ok(sessionView(recon.putPair(seg[2], body)), 201);
    if (is("DELETE", /^\/reconciliation\/sessions\/[^/]+\/pairs\/[^/]+$/))
      return ok(sessionView(recon.deletePair(seg[2], seg[4]!)));
    if (is("POST", /^\/reconciliation\/sessions\/[^/]+\/validate$/))
      return ok(recon.validate(seg[2]));
    if (/^\/reconciliation\/sessions\/[^/]+\/close$/.test(path))
      return fail(
        403,
        "HUMAN_CONFIRMATION_REQUIRED",
        "Closing a period needs the cardholder's confirmation. Hand the matches over with reviewMatches.",
      );
    if (/^\/reports\/[^/]+\/(approve|reimburse)$/.test(path))
      return fail(
        403,
        "HUMAN_CONFIRMATION_REQUIRED",
        "Approvals and payments need a person.",
      );
    if (is("GET", /^\/reports$/)) {
      const rows = store
        .listReports({
          status: (q.get("status") || "all") as ReportStatus | "all",
          employee: q.get("employee") ?? undefined,
        })
        .map(agentReportRow);
      return ok({ count: rows.length, reports: rows.slice(0, 50) });
    }
    if (is("GET", /^\/reports\/[^/]+$/))
      return ok(agentReport(store.getReport(seg[1]!)));
    if (is("GET", /^\/policies$/))
      return ok(agentPolicies(store.searchPolicies(q.get("q") ?? "")));
    if (is("GET", /^\/exports\/[^/]+$/) || is("POST", /^\/webhooks$/))
      return fail(
        403,
        "FORBIDDEN",
        "This integration is not scoped for that endpoint.",
      );
    return fail(404, "NOT_FOUND", `No endpoint ${method} ${path}.`);
  } catch (error) {
    if (error instanceof LedgerError)
      return {
        status: STATUS[error.code] ?? 400,
        body: { error: error.code, message: error.message, ...error.detail },
      };
    console.error("[ledgerline] agent api failed", error);
    return fail(500, "INTERNAL", "Something went wrong on the server.");
  }
}

/** Everything the review card shows: the session's pairs with their receipts. */
export function reviewView(sessionId: string) {
  // Only validated matches are handed over: a review card with a pair that
  // does not balance would put a broken close in front of the person.
  const v = recon.validate(sessionId);
  if (v.valid !== v.total)
    throw new LedgerError(
      "VALIDATION_FAILED",
      `Only ${v.valid} of ${v.total} charges are valid, so there is nothing to review yet.`,
      { valid: v.valid, total: v.total, results: v.results },
    );
  const s = recon.getSession(sessionId);
  const card = recon.cards().find((c) => c.id === s.cardId)!;
  const receipts = recon.receipts(s.cardId);
  const resolutions = recon.resolutionsFor(s.origin, s.cardId);
  return {
    kind: "review-card" as const,
    sessionId: s.id,
    card: {
      id: card.id,
      holder: card.holder,
      last4: card.last4,
      period: card.period,
      periodLabel: card.periodLabel,
    },
    status: s.status,
    pairs: s.transactionIds.map((id) => {
      const t = recon.transaction(id);
      const p = s.pairs[id];
      return {
        transaction: {
          id: t.id,
          postedAt: t.postedAt,
          descriptor: t.descriptor,
          amount: t.amount,
          glAccount: t.glAccount,
        },
        exception: t.exception?.kind ?? null,
        resolution: resolutions[id] ?? null,
        receipts: (p?.receiptIds ?? [])
          .map((rid) => receipts.find((r) => r.id === rid))
          .filter((r) => !!r),
        adjustment: p?.adjustment ?? null,
      };
    }),
  };
}

/** The review card's Confirm: validate, then close. Only ever a person's click. */
export function confirmMatches(sessionId: string) {
  const v = recon.validate(sessionId);
  if (v.valid !== v.total)
    return {
      ok: false,
      error: "VALIDATION_FAILED",
      valid: v.valid,
      total: v.total,
      results: v.results,
      summary: `${v.valid} of ${v.total} charges are valid; nothing was closed.`,
    };
  const c = recon.close(sessionId);
  const card = recon.cards().find((x) => x.id === c.cardId)!;
  return {
    ok: true,
    closed: true,
    sessionId: c.sessionId,
    cardId: c.cardId,
    period: c.period,
    matched: c.matched,
    exceptions: c.exceptions,
    summary: `${card.periodLabel} closed for ${card.holder}'s Visa •• ${card.last4}: ${c.matched} receipts matched, ${c.exceptions} exceptions cleared.`,
  };
}
