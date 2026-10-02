"use client";

import { useCallback, useEffect, useState } from "react";
import { API } from "./client";
import type {
  CardAccount,
  CardTransaction,
  CompanyEvent,
  Department,
  GlAccount,
  Receipt,
} from "./recon-seed";
import { trackedFetch } from "../learning/recorder";

/**
 * The Card close board's client: its view of one card, and the person's
 * writes. Every write is a recorded `network` event with the route TEMPLATE
 * and a small request/response summary. In order (open a session, clear each
 * exception through its workflow, validate, close) they are the recipe a
 * learned skill replays.
 */

export interface Adjustment {
  kind: "gratuity" | "fx_conversion";
  amount?: number;
  currency?: string;
  receiptAmount?: number;
  rate?: number;
}

export interface PairView {
  transactionId: string;
  receiptIds: string[];
  adjustment?: Adjustment;
  note?: string;
  auto?: boolean;
}

export type ResolutionView =
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

export interface SessionView {
  id: string;
  cardId: string;
  period: string;
  status: "open" | "closed";
  transactionIds: string[];
  pairs: Record<string, PairView>;
}

export interface BoardView {
  card: CardAccount;
  closedAt: string | null;
  transactions: (CardTransaction & {
    match: PairView | null;
    resolution: ResolutionView | null;
  })[];
  receipts: (Receipt & { matched: boolean })[];
  session: SessionView | null;
  events: CompanyEvent[];
  departments: Department[];
  glAccounts: GlAccount[];
}

export interface PairResult {
  transactionId: string;
  valid: boolean;
  code?:
    | "WRONG_RECEIPT"
    | "UNBALANCED"
    | "UNMATCHED"
    | "UNRESOLVED"
    | "WRONG_ACCOUNT"
    | "WRONG_SPLIT";
}

export interface CardSummary extends CardAccount {
  attention: number;
  open: number;
  closed: boolean;
}

const R = `${API}/reconciliation`;

async function json<T>(
  res: Response,
): Promise<T & { error?: string; message?: string }> {
  return (await res.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
}

export function useCardSummaries(reloadKey = 0) {
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch(`${R}/board`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ cards: CardSummary[] }>)
      .then((b) => alive && setCards(b.cards))
      .catch(() => alive && setCards([]));
    return () => {
      alive = false;
    };
  }, [reloadKey]);
  return cards;
}

export function useReconBoard(cardId: string) {
  const [board, setBoard] = useState<BoardView | null>(null);
  const refresh = useCallback(async () => {
    const res = await fetch(`${R}/board?card=${encodeURIComponent(cardId)}`, {
      cache: "no-store",
    });
    if (res.ok) setBoard((await res.json()) as BoardView);
  }, [cardId]);
  useEffect(() => {
    let alive = true;
    void fetch(`${R}/board?card=${encodeURIComponent(cardId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json() as Promise<BoardView>)
      .then((b) => alive && setBoard(b));
    return () => {
      alive = false;
    };
  }, [cardId]);
  return { board, refresh };
}

export const reconActions = {
  openSession: async (cardId: string, period: string) => {
    const res = await trackedFetch(`${R}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period, cardId }),
      template: `${R}/sessions`,
      summary: `Open a reconciliation session for ${cardId}, ${period}`,
      request: { period, cardId },
      responseFields: ["id", "period", "cardId"],
    });
    const body = await json<SessionView>(res);
    return res.ok
      ? { ok: true as const, session: body }
      : { ok: false as const, message: body.message };
  },
  pair: async (sessionId: string, pair: PairView, summary: string) => {
    const res = await trackedFetch(
      `${R}/sessions/${encodeURIComponent(sessionId)}/pairs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pair),
        template: `${R}/sessions/[sessionId]/pairs`,
        summary,
        request: {
          sessionId,
          transactionId: pair.transactionId,
          receiptIds: pair.receiptIds,
          ...(pair.adjustment ? { adjustment: pair.adjustment } : {}),
        },
      },
    );
    const body = await json<SessionView>(res);
    return res.ok
      ? { ok: true as const }
      : { ok: false as const, message: body.message };
  },
  unpair: async (sessionId: string, transactionId: string) => {
    const res = await trackedFetch(
      `${R}/sessions/${encodeURIComponent(sessionId)}/pairs/${encodeURIComponent(transactionId)}`,
      {
        method: "DELETE",
        template: `${R}/sessions/[sessionId]/pairs/[transactionId]`,
        summary: `Unmatch ${transactionId}`,
        request: { sessionId, transactionId },
      },
    );
    return { ok: res.ok };
  },
  validate: async (sessionId: string) => {
    const res = await trackedFetch(
      `${R}/sessions/${encodeURIComponent(sessionId)}/validate`,
      {
        method: "POST",
        template: `${R}/sessions/[sessionId]/validate`,
        summary: `Validate ${sessionId}`,
        request: { sessionId },
        responseFields: ["valid", "total"],
      },
    );
    return json<{ valid: number; total: number; results: PairResult[] }>(res);
  },
  /** SPLIT: a draft allocation, its lines, then commit. Three recorded calls. */
  split: async (
    t: CardTransaction,
    lines: { departmentId: string; amount: number }[],
    label: string,
  ) => {
    const draft = await trackedFetch(`${API}/allocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId: t.id }),
      template: `${API}/allocations`,
      summary: `Start an allocation for ${t.descriptor}`,
      request: { transactionId: t.id },
      responseFields: ["id", "status"],
    });
    const a = await json<{ id: string }>(draft);
    if (!draft.ok) return { ok: false as const, message: a.message };
    const put = await trackedFetch(
      `${API}/allocations/${encodeURIComponent(a.id)}/lines`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines }),
        template: `${API}/allocations/[allocationId]/lines`,
        summary: `Allocate ${t.descriptor}: ${label}`,
        request: { allocationId: a.id, lines },
        responseFields: ["id", "lines"],
      },
    );
    const pb = await json<object>(put);
    if (!put.ok) return { ok: false as const, message: pb.message };
    const commit = await trackedFetch(
      `${API}/allocations/${encodeURIComponent(a.id)}/commit`,
      {
        method: "POST",
        template: `${API}/allocations/[allocationId]/commit`,
        summary: `Commit the allocation for ${t.descriptor}`,
        request: { allocationId: a.id },
        responseFields: ["id", "status"],
      },
    );
    const cb = await json<object>(commit);
    return commit.ok
      ? { ok: true as const }
      : { ok: false as const, message: cb.message };
  },
  /** RECLASS: September coding is soft-locked, so a reclass entry is posted. */
  reclass: async (
    t: CardTransaction,
    toAccount: string,
    memo: string,
    label: string,
  ) => {
    const req = {
      transactionId: t.id,
      fromAccount: t.glAccount,
      toAccount,
      memo,
    };
    const res = await trackedFetch(`${API}/journal/reclasses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      template: `${API}/journal/reclasses`,
      summary: `Reclass ${t.descriptor}: ${label}`,
      request: req,
      responseFields: ["entryId", "status"],
    });
    const b = await json<object>(res);
    return res.ok
      ? { ok: true as const }
      : { ok: false as const, message: b.message };
  },
  /** PERSONAL: a repayment, never an edit to the charge. */
  personal: async (
    t: CardTransaction,
    method: "payroll_deduction" | "card_payment",
  ) => {
    const req = { transactionId: t.id, method };
    const res = await trackedFetch(`${API}/repayments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      template: `${API}/repayments`,
      summary: `Mark ${t.descriptor} personal: repay by ${method === "payroll_deduction" ? "payroll deduction" : "card payment"}`,
      request: req,
      responseFields: ["repaymentId", "status"],
    });
    const b = await json<object>(res);
    return res.ok
      ? { ok: true as const }
      : { ok: false as const, message: b.message };
  },
  /** MISSING RECEIPT: the cardholder's affidavit with the business purpose. */
  affidavit: async (t: CardTransaction, memo: string) => {
    const req = { transactionId: t.id, memo };
    const res = await trackedFetch(`${API}/affidavits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      template: `${API}/affidavits`,
      summary: `Missing-receipt affidavit for ${t.descriptor}`,
      request: req,
      responseFields: ["affidavitId", "status", "attestedBy"],
    });
    const b = await json<{ attestedBy?: string }>(res);
    return res.ok
      ? { ok: true as const, attestedBy: b.attestedBy }
      : { ok: false as const, message: b.message };
  },
  close: async (sessionId: string) => {
    const res = await trackedFetch(
      `${R}/sessions/${encodeURIComponent(sessionId)}/close`,
      {
        method: "POST",
        template: `${R}/sessions/[sessionId]/close`,
        summary: `Close the period for ${sessionId}`,
        request: { sessionId },
        responseFields: ["closed", "period", "matched", "exceptions"],
      },
    );
    const body = await json<{ closed?: boolean }>(res);
    return res.ok
      ? { ok: true as const }
      : { ok: false as const, message: body.message };
  },
};

/**
 * What a person reads off the receipts when matching, turned into the pair's
 * adjustment: a currency conversion for a receipt in euros, or the tip written
 * on the slip when the charge is the printed total plus that tip.
 */
export function adjustmentFor(
  t: CardTransaction,
  rs: Receipt[],
): Adjustment | undefined {
  if (rs.length === 0) return undefined;
  const sum = Math.round(rs.reduce((n, r) => n + r.total, 0) * 100) / 100;
  const foreign = rs.find((r) => r.currency !== "USD");
  if (foreign)
    return {
      kind: "fx_conversion",
      currency: foreign.currency,
      receiptAmount: sum,
      rate: Math.round((t.amount / sum) * 10_000) / 10_000,
    };
  const diff = Math.round((t.amount - sum) * 100) / 100;
  const tip = rs.find((r) => r.handwrittenTip)?.handwrittenTip;
  if (diff > 0.009 && tip && Math.abs(tip - diff) < 0.01)
    return { kind: "gratuity", amount: diff };
  return undefined;
}
