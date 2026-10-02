"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  Sparkles,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  Euro,
  Link2,
  Loader2,
  Lock,
  PenLine,
  ShieldCheck,
  Split,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { formatDate, formatMoney } from "../data/format";
import { dayGap } from "../data/recon-seed";
import type { CardTransaction, Receipt } from "../data/recon-seed";
import {
  adjustmentFor,
  reconActions,
  useCardSummaries,
  useReconBoard,
} from "../data/recon-client";
import type { PairResult, PairView } from "../data/recon-client";
import { ReceiptPaper, ReceiptThumb } from "../components/receipt";
import { Avatar, Money, PageHeader, primaryButton } from "../components/ui";
import { useToast } from "../components/toast";
import { emit, emitScreenContext } from "../learning/recorder";
import { ExceptionCard } from "./close-exceptions";

/**
 * CARD CLOSE: the month-end close for one corporate card (beat 3).
 *
 * Receipts match themselves when the close opens (a tip on the slip, a hotel
 * in euros, two receipts for one airline charge). What is left are the
 * EXCEPTIONS, each cleared in its own small workflow on its row: split an
 * offsite by attendees, reclass a miscoded charge, mark a personal charge for
 * repayment, request a missing-receipt affidavit. Then Validate, and Close.
 *
 * Under the hood: a reconciliation SESSION, the exception workflows
 * (allocations, reclass entries, repayments, affidavits), VALIDATE, CLOSE,
 * each a recorded call. Nothing outside this screen describes them.
 */

type Phase = "idle" | "validating" | "valid" | "invalid" | "closing" | "closed";

interface Drag {
  receiptId: string;
  x: number;
  y: number;
}

const MCC: Record<string, string> = {
  "5814": "Coffee shop",
  "5812": "Restaurant",
  "5942": "Online marketplace",
  "7011": "Lodging",
  "3000": "Airline",
  "3075": "Airline",
  "6513": "Coworking",
  "5300": "Wholesale club",
};

const VALIDATE_MS = 1500;
const usd = (n: number) => formatMoney(n);
const eur = (n: number) =>
  `€${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ReconciliationPage() {
  const params = useSearchParams();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const [reload, setReload] = useState(0);
  const cards = useCardSummaries(reload);
  const cardId = params.get("card") ?? "card_4417";
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        title="Card close"
        subtitle="Receipts match themselves. Clear what needs you, validate, then close the month."
        actions={
          cards && cards.length > 1 ? (
            <div
              role="tablist"
              aria-label="Card"
              className="flex rounded-lg border border-hairline bg-surface-muted p-0.5"
            >
              {cards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.id === cardId}
                  data-action={`Card: ${c.holder}`}
                  onClick={() =>
                    router.replace(`${skinHref("reconciliation")}?card=${c.id}`)
                  }
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-2.5 text-[12.5px] transition-colors",
                    c.id === cardId
                      ? "bg-surface font-medium text-ink shadow-[0_1px_2px_hsl(225_20%_20%/0.08)]"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  <Avatar name={c.holder} size="sm" />
                  {c.holder.split(" ")[0]}
                  <span className="ll-mono text-[11px] text-[hsl(var(--ll-faint))]">
                    •• {c.last4}
                  </span>
                  {c.closed ? (
                    <Lock className="h-3 w-3 text-positive" />
                  ) : c.attention ? (
                    <span className="ll-num rounded-full bg-[hsl(var(--ll-amber)/0.16)] px-1.5 text-[11px] font-medium text-[hsl(32_80%_32%)]">
                      {c.attention}
                    </span>
                  ) : (
                    <Check className="h-3 w-3 text-brand" />
                  )}
                </button>
              ))}
            </div>
          ) : null
        }
      />
      <Board
        key={cardId}
        cardId={cardId}
        onClosed={() => setReload((n) => n + 1)}
      />
    </div>
  );
}

function Board({ cardId, onClosed }: { cardId: string; onClosed: () => void }) {
  const { board, refresh } = useReconBoard(cardId);
  const toast = useToast();
  const [local, setLocal] = useState<Record<string, PairView | null>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<Record<string, PairResult> | null>(
    null,
  );
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const menuFor = menu?.id ?? null;
  const setMenuFor = (v: null) => setMenu(v);
  const [preview, setPreview] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const pending = useRef<{ receiptId: string; x: number; y: number } | null>(
    null,
  );
  const opened = useRef(false);

  const card = board?.card;
  const closed = !!board?.closedAt || phase === "closed";
  const sid = board?.session?.id ?? sessionId;

  // Open (or pick up) the month's session, and note what this screen shows.
  useEffect(() => {
    if (!board || opened.current) return;
    opened.current = true;
    emitScreenContext(
      `Card close: clear ${board.card.holder}'s exceptions, validate, then close ${board.card.periodLabel}`,
      {
        view: "reconcile",
        cardId: board.card.id,
        period: board.card.period,
        text: "The close runs in a reconciliation session. Receipts auto-match when it opens. Each exception is cleared in its own workflow: a shared offsite is an allocation split by attendees, a miscoded charge in a soft-locked month is a reclass entry, a personal charge is a repayment, a charge with no receipt is a missing-receipt affidavit. Then validate the session and close the period.",
        exceptions: board.transactions.filter((t) => t.exception).length,
        autoMatched: board.transactions.filter((t) => !t.exception).length,
      },
    );
    if (board.closedAt || board.session) return;
    void reconActions
      .openSession(board.card.id, board.card.period)
      .then((out) => {
        // The session opens with its receipts auto-matched: pull them in.
        if (out.ok) {
          setSessionId(out.session.id);
          void refresh();
        } else
          toast({
            tone: "error",
            title: "The reconciliation session did not open",
            body: out.message,
          });
      });
  }, [board, refresh, toast]);

  const receipts = useMemo(() => board?.receipts ?? [], [board]);
  const receipt = (id: string) => receipts.find((r) => r.id === id);
  const txns = useMemo(
    () => (board?.transactions ?? []).filter((t) => !t.match || closed),
    [board, closed],
  );
  const pairs: Record<string, PairView> = useMemo(() => {
    const out: Record<string, PairView> = { ...board?.session?.pairs };
    if (closed && board)
      for (const t of board.transactions) if (t.match) out[t.id] ??= t.match;
    for (const [k, v] of Object.entries(local)) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
    return out;
  }, [board, local, closed]);
  const usedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of Object.values(pairs))
      for (const r of p.receiptIds) m.set(r, p.transactionId);
    return m;
  }, [pairs]);

  if (!board || !card) {
    return (
      <div className="h-[420px] animate-pulse rounded-[12px] bg-surface-muted" />
    );
  }

  const inbox = receipts.filter((r) => !usedBy.has(r.id) && !r.matched);
  const receiptTxns = txns.filter((t) => !t.exception);
  const exceptionTxns = txns.filter((t) => t.exception);
  const resolutionOf = (id: string) =>
    board.transactions.find((x) => x.id === id)?.resolution ?? null;
  const matchedCount = receiptTxns.filter((t) => pairs[t.id]).length;
  const clearedCount = exceptionTxns.filter((t) => resolutionOf(t.id)).length;
  const readyCount = matchedCount + clearedCount;
  const busy = phase === "validating" || phase === "closing";
  const refs = {
    card,
    events: board.events,
    departments: board.departments,
    glAccounts: board.glAccounts,
  };

  const setPair = async (
    t: CardTransaction,
    receiptIds: string[],
    via: "drag" | "menu",
  ) => {
    if (!sid || closed) return;
    const rs = receiptIds
      .map(receipt)
      .filter((r): r is Receipt & { matched: boolean } => !!r);
    const next: PairView | null = rs.length
      ? { transactionId: t.id, receiptIds, adjustment: adjustmentFor(t, rs) }
      : null;
    setLocal((l) => ({ ...l, [t.id]: next }));
    setResults(null);
    if (phase !== "idle") setPhase("idle");
    setLanded(t.id);
    window.setTimeout(() => setLanded((v) => (v === t.id ? null : v)), 650);
    const out = next
      ? await reconActions.pair(
          sid,
          next,
          `Pair ${t.descriptor} with ${rs.map((r) => `${r.merchant} ${formatDate(r.date)}`).join(" + ")}`,
        )
      : await reconActions.unpair(sid, t.id);
    if (!out.ok) {
      setLocal((l) => {
        const { [t.id]: _drop, ...rest } = l;
        void _drop;
        return rest;
      });
      toast({
        tone: "error",
        title: "That match was not saved",
        body: "message" in out ? String(out.message ?? "") : undefined,
      });
      return;
    }
    if (next)
      emit("click", {
        action: `Match ${rs.at(-1)!.merchant} ${formatDate(rs.at(-1)!.date)} to ${t.descriptor}`,
        role: via === "drag" ? "drag" : "menuitem",
        tag: via === "drag" ? "div" : "button",
        transactionId: t.id,
        receiptIds,
        adjustment: next.adjustment,
      });
    await refresh();
    setLocal((l) => {
      const { [t.id]: _done, ...rest } = l;
      void _done;
      return rest;
    });
  };

  /** Drop a receipt on a charge: it splits when the charge still has room, else replaces. */
  const drop = (
    receiptId: string,
    t: CardTransaction,
    via: "drag" | "menu",
  ) => {
    setMenuFor(null);
    const r = receipt(receiptId);
    if (!r) return;
    // A receipt matched elsewhere moves here.
    const from = usedBy.get(receiptId);
    if (from && from !== t.id) {
      const other = txns.find((x) => x.id === from)!;
      void setPair(
        other,
        pairs[from]!.receiptIds.filter((x) => x !== receiptId),
        via,
      );
    }
    const existing = (pairs[t.id]?.receiptIds ?? []).filter(
      (x) => x !== receiptId,
    );
    const sum = existing
      .map(receipt)
      .reduce((n, x) => n + (x?.currency === "USD" ? x.total : Infinity), 0);
    const split =
      existing.length > 0 &&
      r.currency === "USD" &&
      sum + r.total <= t.amount + 0.01;
    void setPair(t, split ? [...existing, receiptId] : [receiptId], via);
  };

  const validate = async () => {
    if (!sid) return;
    setPhase("validating");
    setResults(null);
    const [out] = await Promise.all([
      reconActions.validate(sid),
      new Promise((r) => setTimeout(r, VALIDATE_MS)),
    ]);
    const map = Object.fromEntries(
      (out.results ?? []).map((r) => [r.transactionId, r]),
    );
    setResults(map);
    const ok = out.valid === out.total && out.total > 0;
    setPhase(ok ? "valid" : "invalid");
    emit("recon.validated", {
      sessionId: sid,
      cardId: card.id,
      period: card.period,
      valid: out.valid,
      total: out.total,
      results: (out.results ?? []).map((res) => {
        const t = txns.find((x) => x.id === res.transactionId);
        return {
          ...res,
          descriptor: t?.descriptor,
          reason:
            res.valid || !t
              ? undefined
              : reasonFor(res, t, pairs[t.id], receipt),
        };
      }),
      pairs: Object.values(pairs).map((p) => ({
        transactionId: p.transactionId,
        descriptor: txns.find((x) => x.id === p.transactionId)?.descriptor,
        amount: txns.find((x) => x.id === p.transactionId)?.amount,
        postedAt: txns.find((x) => x.id === p.transactionId)?.postedAt,
        receipts: p.receiptIds.map((id) => {
          const r = receipt(id);
          return {
            id,
            merchant: r?.merchant,
            date: r?.date,
            total: r?.total,
            currency: r?.currency,
            handwrittenTip: r?.handwrittenTip,
          };
        }),
        adjustment: p.adjustment,
        auto: p.auto,
      })),
      exceptions: exceptionTxns.map((t) => ({
        transactionId: t.id,
        descriptor: t.descriptor,
        amount: t.amount,
        mcc: t.mcc,
        glAccount: t.glAccount,
        kind: t.exception!.kind,
        exception: t.exception,
        resolution: resolutionOf(t.id),
      })),
    });
  };

  const closeMonth = async () => {
    if (!sid) return;
    setPhase("closing");
    const out = await reconActions.close(sid);
    if (!out.ok) {
      setPhase("invalid");
      toast({
        tone: "error",
        title: `${card.periodLabel} did not close`,
        body: out.message,
      });
      return;
    }
    emit("recon.period_closed", {
      sessionId: sid,
      cardId: card.id,
      period: card.period,
      matched: matchedCount,
      exceptions: clearedCount,
    });
    setPhase("closed");
    await refresh();
    onClosed();
  };

  // ── Pointer drag ─────────────────────────────────────────────────────
  const targetAt = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-txn]")?.dataset
      .txn ?? null;
  const onDown = (e: ReactPointerEvent<HTMLElement>, receiptId: string) => {
    if (e.button !== 0 || busy || closed) return;
    if ((e.target as HTMLElement).closest("button")) return;
    pending.current = { receiptId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pending.current;
    if (!p) return;
    if (!drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
    setDrag({ receiptId: p.receiptId, x: e.clientX, y: e.clientY });
    setOver(targetAt(e.clientX, e.clientY));
    // Near the top or bottom of the page, scroll it so every charge is reachable.
    const main = document.querySelector("main");
    if (main) {
      const box = main.getBoundingClientRect();
      if (e.clientY > box.bottom - 72) main.scrollBy({ top: 18 });
      else if (e.clientY < box.top + 56) main.scrollBy({ top: -18 });
    }
  };
  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pending.current;
    pending.current = null;
    if (drag && p) {
      const id = targetAt(e.clientX, e.clientY);
      const t = id ? txns.find((x) => x.id === id) : undefined;
      if (t) drop(p.receiptId, t, "drag");
    } else if (p) {
      openPreview(p.receiptId);
    }
    setDrag(null);
    setOver(null);
  };

  /** Open a receipt large, and note what a person reads on it that the API does not carry. */
  function openPreview(id: string) {
    setPreview(id);
    const r = receipt(id);
    if (!r) return;
    const seen = [
      `${r.merchant}, ${formatDate(r.date)}: printed total ${r.currency === "EUR" ? eur(r.total) : usd(r.total)}`,
      r.handwrittenTip
        ? `tip ${usd(r.handwrittenTip)} written by hand, ${usd(r.total + r.handwrittenTip)} with the tip`
        : null,
      r.currency !== "USD" ? `billed in ${r.currency}` : null,
      r.reference ?? null,
    ].filter(Boolean);
    emitScreenContext(`Receipt: ${r.merchant} ${formatDate(r.date)}`, {
      view: "receipt",
      cardId: card?.id,
      receiptId: r.id,
      text: seen.join("; "),
    });
  }

  const draggedReceipt = drag ? receipt(drag.receiptId) : undefined;
  const previewReceipt = preview ? receipt(preview) : undefined;
  const invalidCount = results
    ? Object.values(results).filter((r) => !r.valid).length
    : 0;

  return (
    <>
      {closed ? (
        <div
          data-testid="recon-closed"
          className="ll-pop-in mb-4 flex items-center gap-3 rounded-[10px] border border-positive/25 bg-positive-soft px-4 py-3"
        >
          <CheckCircle2 className="h-5 w-5 text-positive" />
          <div className="text-[13px]">
            <span className="font-semibold">{card.periodLabel} closed</span>{" "}
            <span className="text-ink-muted">
              for {card.holder}&apos;s Visa •• {card.last4}. Every receipt is
              matched and every exception cleared.
            </span>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <CreditCard className="h-3.5 w-3.5" /> {card.holder} · Visa ••{" "}
          {card.last4}
        </span>
        <span className="flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" /> {card.periodLabel} statement
        </span>
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-brand" />
          <span className="ll-num font-medium text-ink">
            {matchedCount}
          </span>{" "}
          auto-matched
        </span>
        <span className="flex items-center gap-2">
          <span className="ll-num font-medium text-ink">
            {readyCount} of {txns.length}
          </span>{" "}
          ready to close
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-muted">
            <span
              className="block h-full rounded-full bg-brand transition-[width] duration-300"
              style={{
                width: `${txns.length ? (readyCount / txns.length) * 100 : 0}%`,
              }}
            />
          </span>
        </span>
      </div>

      <div className="grid gap-5 @[680px]:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
        {/* Card charges */}
        <section aria-label="Card charges" className="pb-16">
          {exceptionTxns.length ? (
            <>
              <h2 className="mb-2 flex items-center justify-between text-[12px] font-medium text-ink-muted">
                <span>{closed ? "Exceptions" : "Needs you"}</span>
                <span className="ll-num">
                  {closed
                    ? exceptionTxns.length
                    : `${exceptionTxns.length - clearedCount} of ${exceptionTxns.length}`}
                </span>
              </h2>
              <ul className="mb-6 space-y-2">
                {exceptionTxns.map((t) => (
                  <ExceptionCard
                    key={t.id}
                    t={t}
                    refs={refs}
                    resolution={resolutionOf(t.id)}
                    result={results?.[t.id]}
                    closed={closed}
                    busy={busy}
                    onResolved={async () => {
                      setResults(null);
                      if (phase !== "idle") setPhase("idle");
                      await refresh();
                      onClosed();
                    }}
                  />
                ))}
              </ul>
            </>
          ) : null}
          <h2 className="mb-2 flex items-center justify-between text-[12px] font-medium text-ink-muted">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              Auto-matched receipts
            </span>
            <span className="ll-num">{receiptTxns.length}</span>
          </h2>
          <ul className="space-y-2">
            {receiptTxns.map((t) => {
              const p = pairs[t.id];
              const rs = (p?.receiptIds ?? [])
                .map(receipt)
                .filter((x): x is Receipt & { matched: boolean } => !!x);
              const res = results?.[t.id];
              const isOver = over === t.id && !!drag;
              return (
                <li
                  key={t.id}
                  data-txn={t.id}
                  data-testid="recon-txn"
                  className={cn(
                    "rounded-[10px] border bg-surface transition-[border-color,background-color,box-shadow] duration-150",
                    isOver
                      ? "border-brand bg-brand-soft/60 ring-4 ring-brand-soft"
                      : res && !res.valid
                        ? "border-negative/40"
                        : res?.valid
                          ? "border-positive/35"
                          : p
                            ? "border-brand/30"
                            : drag
                              ? "border-dashed border-brand/40"
                              : "border-hairline",
                    phase === "validating" && p && "ll-checking",
                    landed === t.id && "ll-landed",
                  )}
                >
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <div className="flex w-10 shrink-0 flex-col items-center rounded-md border border-hairline py-1 leading-none">
                      <span className="text-[9.5px] font-medium uppercase tracking-wide text-[hsl(var(--ll-faint))]">
                        {formatDate(t.postedAt).split(" ")[0]}
                      </span>
                      <span className="ll-num text-[15px] font-semibold">
                        {formatDate(t.postedAt).split(" ")[1]}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="ll-mono truncate text-[12.5px] font-medium tracking-[0.01em]">
                        {t.descriptor}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-[hsl(var(--ll-faint))]">
                        {MCC[t.mcc] ?? "Card charge"} · posted{" "}
                        {formatDate(t.postedAt)} · •• {card.last4}
                      </div>
                    </div>
                    <Money
                      value={t.amount}
                      className="text-[14px] font-semibold"
                    />
                    {res ? (
                      res.valid ? (
                        <CheckCircle2
                          aria-label="Valid"
                          className="h-4 w-4 shrink-0 text-positive"
                        />
                      ) : (
                        <CircleAlert
                          aria-label="Not valid"
                          className="h-4 w-4 shrink-0 text-negative"
                        />
                      )
                    ) : null}
                  </div>
                  {p && rs.length ? (
                    <div className="ll-pop-in flex items-center gap-3 border-t border-hairline px-3.5 py-2.5">
                      <div className="flex -space-x-3">
                        {rs.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            aria-label={`Preview ${r.merchant} receipt`}
                            onClick={() => openPreview(r.id)}
                            className="rounded-[5px] ring-2 ring-surface"
                          >
                            <ReceiptThumb receipt={r} width={34} height={44} />
                          </button>
                        ))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium">
                          {rs
                            .map((r) => r.merchant)
                            .filter((m, i, a) => a.indexOf(m) === i)
                            .join(" + ")}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <MatchChips t={t} rs={rs} pair={p} />
                        </div>
                      </div>
                      {!closed ? (
                        <button
                          type="button"
                          aria-label={`Unmatch ${t.descriptor}`}
                          data-action={`Unmatch ${t.descriptor}`}
                          disabled={busy}
                          onClick={() => void setPair(t, [], "menu")}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <Lock className="h-3.5 w-3.5 text-[hsl(var(--ll-faint))]" />
                      )}
                    </div>
                  ) : !closed ? (
                    <div className="border-t border-dashed border-hairline px-3.5 py-2 text-[12px] text-[hsl(var(--ll-faint))]">
                      {isOver
                        ? "Release to match this receipt"
                        : "Drop a receipt here"}
                    </div>
                  ) : null}
                  {res && !res.valid ? (
                    <div
                      role="alert"
                      data-testid="recon-reason"
                      className="flex items-start gap-2 border-t border-negative/20 bg-negative-soft px-3.5 py-2 text-[12.5px] text-negative"
                    >
                      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {reasonFor(res, t, p, receipt)}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Receipts inbox */}
        <section
          aria-label="Receipts inbox"
          className="@[680px]:sticky @[680px]:top-0 @[680px]:max-h-[calc(100dvh-120px)] @[680px]:self-start @[680px]:overflow-y-auto @[680px]:pb-20"
        >
          <h2 className="mb-2 flex items-center justify-between text-[12px] font-medium text-ink-muted">
            <span>Receipts not on a charge</span>
            <span className="ll-num">{inbox.length}</span>
          </h2>
          {inbox.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-hairline text-[12.5px] text-ink-muted">
              <Check className="h-4 w-4 text-positive" />
              {closed
                ? "All receipts are matched."
                : "Every receipt is on a charge."}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 @[1180px]:grid-cols-3">
              {inbox.map((r) => (
                <li key={r.id} className="relative">
                  <div
                    data-testid="recon-receipt"
                    data-receipt={r.id}
                    role="group"
                    aria-label={`${r.merchant} receipt, ${formatDate(r.date)}, ${r.currency === "EUR" ? eur(r.total) : usd(r.total)}`}
                    onPointerDown={(e) => onDown(e, r.id)}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={() => {
                      pending.current = null;
                      setDrag(null);
                      setOver(null);
                    }}
                    className={cn(
                      "group touch-none select-none rounded-[10px] border border-hairline bg-surface p-2 transition-[border-color,box-shadow,opacity] duration-150",
                      busy || closed
                        ? "cursor-default"
                        : "cursor-grab hover:border-[hsl(225_10%_80%)] hover:shadow-[0_2px_8px_-2px_hsl(225_30%_20%/0.12)] active:cursor-grabbing",
                      drag?.receiptId === r.id && "opacity-30",
                      closed && "opacity-55",
                    )}
                  >
                    <div className="relative">
                      <ReceiptThumb receipt={r} width={128} height={132} fill />
                      {closed ? null : (
                        <button
                          type="button"
                          aria-label={`Match ${r.merchant} ${formatDate(r.date)} to...`}
                          aria-haspopup="menu"
                          aria-expanded={menuFor === r.id}
                          data-action={`Match menu: ${r.merchant} ${formatDate(r.date)}`}
                          disabled={busy || closed}
                          onClick={(e) => {
                            if (menuFor === r.id) return setMenu(null);
                            // Fixed, so the inbox's own scroll box never clips it.
                            const b = e.currentTarget.getBoundingClientRect();
                            const h = 40 + receiptTxns.length * 32;
                            setMenu({
                              id: r.id,
                              left: Math.max(8, b.right - 288),
                              top:
                                b.bottom + 4 + h > window.innerHeight
                                  ? Math.max(8, b.top - 4 - h)
                                  : b.bottom + 4,
                            });
                          }}
                          className="absolute bottom-1.5 right-1.5 flex h-6 items-center gap-1 rounded-full border border-hairline bg-surface/95 px-2 text-[11px] font-medium text-brand shadow-[0_1px_2px_hsl(225_20%_20%/0.08)] hover:border-brand/40"
                        >
                          <Link2 className="h-3 w-3" /> Match
                        </button>
                      )}
                    </div>
                    <div className="mt-2 px-0.5">
                      <div className="truncate text-[12.5px] font-medium">
                        {r.merchant}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11.5px] text-[hsl(var(--ll-faint))]">
                        <span>{formatDate(r.date)}</span>
                        <span
                          className={cn(
                            "ll-num whitespace-nowrap",
                            r.currency === "EUR"
                              ? "font-medium text-ink-muted"
                              : "text-ink-muted",
                          )}
                        >
                          {r.currency === "EUR" ? eur(r.total) : usd(r.total)}
                          {r.handwrittenTip ? (
                            <span className="text-[hsl(var(--ll-faint))]">
                              {" "}
                              + tip
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  </div>
                  {menu && menuFor === r.id ? (
                    <div
                      role="menu"
                      aria-label={`Match ${r.merchant} to`}
                      className="ll-pop-in fixed z-[60] w-72 overflow-hidden rounded-lg border border-hairline bg-surface py-1"
                      style={{
                        boxShadow: "var(--ll-shadow)",
                        left: menu.left,
                        top: menu.top,
                      }}
                    >
                      <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-[hsl(var(--ll-faint))]">
                        Match to
                      </div>
                      {receiptTxns.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="menuitem"
                          onClick={() => drop(r.id, t, "menu")}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-muted"
                        >
                          <span className="ll-mono flex-1 truncate text-[11.5px]">
                            {t.descriptor}
                          </span>
                          <Money value={t.amount} className="text-ink-muted" />
                          {pairs[t.id] ? (
                            <Check className="h-3.5 w-3.5 text-brand" />
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Footer */}
      {!closed || phase === "closed" ? (
        <div
          className="sticky bottom-0 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-hairline bg-surface/95 px-4 py-3 backdrop-blur"
          style={{ boxShadow: "0 -6px 16px -12px hsl(225 30% 20% / 0.25)" }}
        >
          <div className="text-[12.5px]" aria-live="polite">
            {phase === "validating" ? (
              <span className="flex items-center gap-1.5 font-medium text-brand-indigo">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking{" "}
                {matchedCount} match{matchedCount === 1 ? "" : "es"}...
              </span>
            ) : phase === "valid" || phase === "closing" ? (
              <span
                data-testid="recon-valid"
                className="ll-pop-in flex items-center gap-1.5 font-medium text-positive"
              >
                <ShieldCheck className="h-4 w-4" /> {txns.length} of{" "}
                {txns.length} valid
              </span>
            ) : phase === "invalid" ? (
              <span
                data-testid="recon-invalid"
                className="ll-pop-in flex items-center gap-1.5 font-medium text-negative"
              >
                <CircleAlert className="h-4 w-4" /> {txns.length - invalidCount}{" "}
                of {txns.length} valid. Fix the{" "}
                {invalidCount === 1 ? "charge" : "charges"} marked in red.
              </span>
            ) : phase === "closed" ? (
              <span className="flex items-center gap-1.5 font-medium text-positive">
                <CheckCircle2 className="h-4 w-4" /> {card.periodLabel} closed
              </span>
            ) : (
              <span className="text-ink-muted">
                {readyCount === txns.length
                  ? "Every charge is matched or cleared. Validate before closing."
                  : `${txns.length - readyCount} exception${txns.length - readyCount === 1 ? "" : "s"} still need${txns.length - readyCount === 1 ? "s" : ""} you.`}
              </span>
            )}
          </div>
          {phase === "closed" ? null : phase === "valid" ||
            phase === "closing" ? (
            <button
              type="button"
              data-action={`Close ${card.periodLabel}`}
              data-testid="recon-close"
              className={primaryButton}
              disabled={phase === "closing"}
              onClick={() => void closeMonth()}
            >
              {phase === "closing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
              Close {card.periodLabel}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="hidden text-[11.5px] text-[hsl(var(--ll-faint))] @[700px]:inline">
                Validate checks every charge before the month closes
              </span>
              <button
                type="button"
                data-action="Validate matches"
                data-testid="recon-validate"
                className={primaryButton}
                disabled={busy || !sid}
                onClick={() => void validate()}
              >
                {phase === "validating" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Validate
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* The receipt under the pointer while dragging */}
      {drag && draggedReceipt ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[80] rotate-[-2deg] rounded-[8px] bg-surface p-1"
          style={{
            left: drag.x - 46,
            top: drag.y - 60,
            boxShadow:
              "0 14px 34px -8px hsl(225 40% 20% / 0.35), 0 2px 6px hsl(225 30% 20% / 0.1)",
          }}
        >
          <ReceiptThumb receipt={draggedReceipt} width={92} height={118} />
        </div>
      ) : null}

      {/* Receipt preview */}
      {previewReceipt ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[hsl(225_20%_10%/0.28)] p-6"
          onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}
        >
          <div
            role="dialog"
            aria-label={`${previewReceipt.merchant} receipt`}
            className="ll-pop-in relative"
          >
            <div
              className="max-h-[80vh] overflow-auto rounded-[8px] bg-[hsl(225_14%_95%)] p-5"
              style={{ boxShadow: "var(--ll-shadow)" }}
            >
              <div style={{ zoom: 1.4 }}>
                <ReceiptPaper receipt={previewReceipt} />
              </div>
            </div>
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setPreview(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-surface text-ink-muted"
              style={{ boxShadow: "var(--ll-shadow)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** The chips a person reads on a match: what made it fit. */
function MatchChips({
  t,
  rs,
  pair,
}: {
  t: CardTransaction;
  rs: Receipt[];
  pair: PairView;
}) {
  const chips: {
    icon: typeof Check;
    text: string;
    tone?: "brand" | "amber";
  }[] = [];
  const a = pair.adjustment;
  if (rs.length > 1)
    chips.push({
      icon: Split,
      text: `Split · ${rs.length} receipts`,
      tone: "brand",
    });
  if (a?.kind === "gratuity" && a.amount)
    chips.push({
      icon: PenLine,
      text: `Tip ${usd(a.amount)} from the slip`,
      tone: "brand",
    });
  if (a?.kind === "fx_conversion" && a.receiptAmount && a.rate)
    chips.push({
      icon: Euro,
      text: `${eur(a.receiptAmount)} at ${a.rate.toFixed(4)} = ${usd(t.amount)}`,
      tone: "brand",
    });
  const gap = Math.max(...rs.map((r) => dayGap(r.date, t.postedAt)));
  if (gap >= 1 && gap <= 4)
    chips.push({
      icon: CalendarClock,
      text: `Posted ${gap} day${gap === 1 ? "" : "s"} after purchase`,
    });
  else if (Math.abs(gap) > 4)
    chips.push({
      icon: CalendarClock,
      text: `Receipt dated ${Math.abs(gap)} days ${gap > 0 ? "before" : "after"} the charge`,
      tone: "amber",
    });
  const sum = rs.reduce((n, r) => n + (r.currency === "USD" ? r.total : 0), 0);
  if (
    !a &&
    rs.every((r) => r.currency === "USD") &&
    Math.abs(sum - t.amount) > 0.009
  )
    chips.push({
      icon: ArrowLeftRight,
      text: `Receipts ${usd(sum)} vs charge ${usd(t.amount)}`,
      tone: "amber",
    });
  if (!chips.length) chips.push({ icon: Check, text: "Amount and date match" });
  return (
    <>
      {chips.map((c) => (
        <span
          key={c.text}
          className={cn(
            "inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium",
            c.tone === "brand"
              ? "bg-brand-soft text-brand-indigo"
              : c.tone === "amber"
                ? "bg-[hsl(var(--ll-amber)/0.16)] text-[hsl(32_80%_30%)]"
                : "bg-surface-muted text-ink-muted",
          )}
        >
          <c.icon className="h-3 w-3" /> {c.text}
        </span>
      ))}
    </>
  );
}

/** Why a pair failed, from what the person can see on the receipts. */
function reasonFor(
  res: PairResult,
  t: CardTransaction,
  pair: PairView | undefined,
  receipt: (id: string) => Receipt | undefined,
): string {
  if (res.code === "UNMATCHED" || !pair)
    return "No receipt is matched to this charge yet.";
  const rs = pair.receiptIds.map(receipt).filter((r): r is Receipt => !!r);
  if (res.code === "WRONG_RECEIPT") {
    const far = rs.find((r) => Math.abs(dayGap(r.date, t.postedAt)) > 4);
    if (far)
      return `${far.merchant}, ${formatDate(far.date)} is ${Math.abs(dayGap(far.date, t.postedAt))} days ${dayGap(far.date, t.postedAt) > 0 ? "before" : "after"} this charge posted (${formatDate(t.postedAt)}), so it belongs to another statement.`;
    return `${rs.map((r) => r.merchant).join(" + ")} is not this charge.`;
  }
  const sum = rs.reduce((n, r) => n + r.total, 0);
  const foreign = rs.find((r) => r.currency !== "USD");
  if (foreign)
    return `The receipt is in ${foreign.currency}; the pair needs the conversion to ${usd(t.amount)}.`;
  return `The receipts total ${usd(sum)}${pair.adjustment?.amount ? ` plus a ${usd(pair.adjustment.amount)} tip` : ""}, but the charge is ${usd(t.amount)}.`;
}
