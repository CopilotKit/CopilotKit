/**
 * `ledgerlineApi`: the agent's generic tool over Ledgerline's integration API,
 * the same for the in-app agent and for ChatGPT over MCP. SERVER-ONLY.
 *
 * The agent gets a terse endpoint index and nothing else. Receipts come back
 * as merchant, date, total and currency only: the tip written on a slip, the
 * line items and the folio are on the receipt IMAGE, which a person sees on
 * the Card close board. How a match is made (a reconciliation session, one
 * pair per charge, what goes in a pair's adjustment) is described nowhere the
 * agent can read. That is what it cannot work out and a product trajectory
 * can teach.
 *
 * Closing a period is deliberately NOT reachable here: the agent hands the
 * matches over with `reviewMatches`, and only the person's Confirm closes.
 */

import * as store from "./store";
import { LedgerError } from "./store";
import * as recon from "./recon-store";
import { agentPolicies, agentReport, agentReportRow } from "./agent-view";
import type { ReportStatus } from "./types";

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
};

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

export function agentApi(
  methodIn: string,
  pathIn: string,
  bodyIn?: unknown,
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
          unmatched: c.unmatched,
        })),
      });
    if (is("GET", /^\/transactions$/)) {
      const card = cardOf(q.get("card"));
      if (q.get("card") && !card)
        return fail(404, "NOT_FOUND", `There is no card ${q.get("card")}.`);
      const rows = recon.unmatchedTransactions(card?.id).map((t) => ({
        id: t.id,
        cardId: t.cardId,
        postedAt: t.postedAt,
        descriptor: t.descriptor,
        amount: t.amount,
        currency: "USD",
        status: "unmatched",
      }));
      return ok({ count: rows.length, transactions: rows });
    }
    if (is("GET", /^\/transactions\/[^/]+$/)) {
      const t = recon.transaction(seg[1]!);
      return ok({ ...t, currency: "USD" });
    }
    if (is("PATCH", /^\/transactions\/[^/]+$/)) recon.patchTransaction(seg[1]!);
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
      return ok(sessionView(recon.createSession(body, "api")), 201);
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
      `Only ${v.valid} of ${v.total} matches are valid, so there is nothing to review yet.`,
      { valid: v.valid, total: v.total, results: v.results },
    );
  const s = recon.getSession(sessionId);
  const card = recon.cards().find((c) => c.id === s.cardId)!;
  const receipts = recon.receipts(s.cardId);
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
        },
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
      summary: `${v.valid} of ${v.total} matches are valid; nothing was closed.`,
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
    summary: `${card.periodLabel} closed for ${card.holder}'s Visa •• ${card.last4}: ${c.matched} charges matched.`,
  };
}
