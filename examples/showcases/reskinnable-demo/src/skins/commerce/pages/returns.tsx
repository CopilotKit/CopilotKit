"use client";

import { useMemo, useState } from "react";
import { Check, Clock, RotateCcw, X } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useCommerceLedger } from "../data/ledger-context";
import {
  RETURN_REASON_LABEL,
  ageInDays,
  formatMoney,
  formatMoneyExact,
  openReturns,
  refundCeilingLabel,
  refundGuidance,
} from "../data/derive";
import type { ReturnRequest, ReturnStatus } from "../data/types";
import { describeError } from "../settle";
import { SkuTile } from "../components/sku-tile";
import { useInFlight } from "../components/use-in-flight";
import {
  activeSelectClass,
  EmptyState,
  Metric,
  PageHeader,
  Panel,
  Pill,
  SectionLabel,
} from "../components/primitives";

/**
 * The returns desk — and beat 3a's surface.
 *
 * A return that has been approved but not yet refunded is the one thing on this
 * page waiting on a FIGURE, and that figure is the beat: the merchant types it
 * into a card in the chat, it goes straight to REST, and the assistant is told
 * only that a refund was issued and to whom. The same control exists here on the
 * page, because an app where the only way to do something is to ask the
 * assistant is not an app — it is a chatbot with a background image.
 */

const STATUS_FILTERS = [
  "all",
  "requested",
  "approved",
  "refunded",
  "declined",
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function statusTone(status: ReturnStatus) {
  if (status === "refunded") return "positive" as const;
  if (status === "declined") return "neutral" as const;
  if (status === "approved") return "brand" as const;
  return "markdown" as const;
}

/**
 * What a refund attempt resolves — the ONE place this page separates "the money
 * moved" from "the screen agrees".
 *
 * `landed` is about the MONEY and nothing else. A refund that went through and
 * whose ledger re-read failed is `landed: true, stale: true`, which is the same
 * split `settle.ts`'s `staleNote` makes for the chat card's receipt. It used to be
 * collapsed into one `string | null`: a landed-but-stale refund came back as a
 * MESSAGE, the control read any message as a refusal, and it therefore kept the
 * typed figure and re-armed the button — inviting a second refund for money that
 * had already moved. On the one path in this app that moves money, that is the
 * worst available shape of failure.
 */
type RefundOutcome =
  | { landed: true; stale: boolean }
  | { landed: false; refusal: string };

/**
 * Shown when the refund itself went through but `refresh()` reported it could not
 * re-read the ledger. Says both halves, in that order: the money moved, and the
 * rows are behind. Never phrased as a failure — see `RefundOutcome`.
 */
const REFUND_STALE_NOTICE =
  "That refund went through, but this page could not be re-read afterwards — reload it to confirm.";

function RefundControl({
  request,
  onRefund,
}: {
  request: ReturnRequest;
  onRefund: (amount: number) => Promise<RefundOutcome>;
}) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  /**
   * A refund LANDED from this control. One-way on purpose, and never cleared: on
   * a good re-read the row becomes `refunded` and this control unmounts, so the
   * ONLY way it is still on screen after a landed refund is a re-read that failed
   * — and re-arming the button there offers a second refund for money that has
   * already moved.
   */
  const [issued, setIssued] = useState(false);
  // One write in flight, guarded synchronously and released in a `finally`. This
  // control had a `useState` boolean and no `try/finally`, so a rejecting fetch
  // wedged the button on "Issuing…" for the rest of the demo.
  const { busy, run } = useInFlight();

  // Same single source as the chat card's control: the placeholder is built from
  // the exact ceiling the button compares against. See `refundGuidance`.
  const {
    placeholder,
    amount: parsed,
    valid,
    problem,
  } = refundGuidance(request.itemValue, value);
  // A refusal the operator cannot see is a button that reads as dead — the same
  // complaint `refundGuidance`'s header makes. The route's own message wins when
  // there is one; `problem` speaks only about what is in the box right now.
  const feedback = note ?? problem;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5">
        <span className="text-[0.68rem] font-medium text-ink-muted">
          Refund
        </span>
        <input
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setNote(null);
          }}
          disabled={issued}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          className="bw-num w-32 rounded-md border border-hairline bg-surface px-2 py-1 text-[0.76rem] text-ink outline-none focus:border-brand/50 disabled:opacity-40"
        />
      </label>
      <button
        type="button"
        disabled={!valid || busy !== null || issued}
        onClick={() =>
          void run(request.id, async () => {
            const outcome = await onRefund(parsed);
            if (!outcome.landed) {
              // Nothing moved: say why, and leave the figure typed so the
              // operator fixes it rather than retyping it on stage.
              setNote(outcome.refusal);
              return false;
            }
            setIssued(true);
            setValue("");
            setNote(outcome.stale ? REFUND_STALE_NOTICE : null);
            return true;
          })
        }
        className="rounded-md bg-brand px-3 py-1 text-[0.73rem] font-semibold text-brand-foreground disabled:opacity-40"
      >
        {issued ? "Refund issued" : busy !== null ? "Issuing…" : "Issue refund"}
      </button>
      {feedback ? (
        <span
          className={cn(
            "text-[0.7rem]",
            // A landed refund's note is not a refusal and must not be dressed as
            // one: from the back of a room red text beside a spent control reads
            // as "the money did not move".
            issued ? "text-ink-muted" : "text-negative",
          )}
        >
          {feedback}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Shown when a write landed but `refresh()` reported it could not re-read the
 * ledger (see its contract in `data/ledger-context`). The approve/decline
 * buttons have no receipt of their own — the row changing IS the receipt — so
 * without this a failed re-read looks exactly like a button that does nothing.
 * Distinct from a REFUSAL: the write did happen, only the view is behind.
 */
const STALE_LEDGER_NOTICE =
  "That went through, but this page could not be re-read afterwards — the rows below may be out of date. Reload to confirm.";

export function ReturnsPage() {
  const { data, refresh } = useCommerceLedger();
  const [status, setStatus] = useState<StatusFilter>("all");
  // One slot for both things that can stop the row from moving: the route
  // refusing the decision, and a `refresh()` that could not re-read afterwards.
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * ONE guard for every decision on this page, not one per row.
   *
   * The granularity is set by the MESSAGE CHANNEL, not by the record: every
   * approve and decline on the page reports through the single `notice` above, so
   * two decisions in flight together means the one that finishes last speaks for
   * both — a refusal on row A erased by row B's success, which is the same silent
   * no-op as a button that never fired. A per-row mutex would close the
   * double-click hole and leave that one open.
   *
   * The refund control is deliberately NOT on this guard: it reports into its own
   * inline slot beside its own button, so it owns its own instance.
   */
  const { busy, run } = useInFlight();

  const productName = (id: string) =>
    data.products.find((p) => p.id === id)?.name ?? "Unknown product";

  const visible = useMemo(() => {
    const rows = data.returns.filter(
      (r) => status === "all" || r.status === status,
    );
    // Anything awaiting a decision or a refund floats to the top; settled rows
    // sink. Within each group, oldest first — this is a queue, not an archive.
    const rank = (r: ReturnRequest) =>
      r.status === "approved" ? 0 : r.status === "requested" ? 1 : 2;
    return [...rows].sort(
      (a, b) => rank(a) - rank(b) || a.requestedAt.localeCompare(b.requestedAt),
    );
  }, [data.returns, status]);

  /**
   * Approve or decline, and report a refusal rather than repainting the same row.
   *
   * `store.decideReturn` throws `ALREADY_DECIDED` (409) for a row that has moved
   * on since this snapshot — a double click, or the assistant deciding the same
   * request from the chat — and `NOT_FOUND` (404) after a presenter reset. This
   * used to `refresh()` regardless, so both answers looked exactly like a button
   * that does nothing. The route's own `message` is preferred over the fallback:
   * those strings (`data/http.ts`) are written to be read by a human.
   *
   * Resolves "did this decision LAND", for the guard above. Total: a `fetch` that
   * never answers at all is reported here rather than thrown, because a throw out
   * of the click handler is a decision that vanished with the page silent.
   */
  const decide = async (
    id: string,
    next: "approved" | "declined",
  ): Promise<boolean> => {
    let res: Response;
    try {
      res = await fetch(`/api/commerce/v1/returns/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } catch (error) {
      setNotice(
        `That return could not be ${next}: ${describeError(error)}. ` +
          "Nothing came back, so treat it as not applied.",
      );
      return false;
    }
    if (!res.ok) {
      const problem = await res.json().catch(() => ({}));
      setNotice(
        problem?.message ?? `That return could not be ${next} (${res.status}).`,
      );
      return false;
    }
    setNotice((await refresh()) ? null : STALE_LEDGER_NOTICE);
    return true;
  };

  /**
   * Beat 3a's write from the page. Reports the money and the view SEPARATELY —
   * see `RefundOutcome` — and, like `decide`, is total: a refund that never
   * reached the server is a refusal with a reason, not a throw out of a click
   * handler.
   */
  const refund = async (id: string, amount: number): Promise<RefundOutcome> => {
    let res: Response;
    try {
      res = await fetch(`/api/commerce/v1/returns/${id}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount }),
      });
    } catch (error) {
      return {
        landed: false,
        refusal:
          `That refund did not go through: ${describeError(error)}. ` +
          "Nothing came back, so treat it as not applied.",
      };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        landed: false,
        refusal: body?.message ?? `Refund failed (${res.status}).`,
      };
    }
    // The money moved. Whether the SCREEN caught up is a separate fact, and the
    // control renders it as a note rather than as a refusal.
    return { landed: true, stale: !(await refresh()) };
  };

  const awaitingRefund = data.returns.filter((r) => r.status === "approved");
  const open = openReturns(data.returns);
  const refundedValue = data.returns.reduce(
    (sum, r) => sum + (r.refundAmount ?? 0),
    0,
  );

  // ── BEAT 3b ──────────────────────────────────────────────────────────────
  useAgentContext({
    description:
      "The Returns page the user is currently viewing: the active status " +
      "filter and the return rows actually visible on screen, in the order " +
      "shown, with each one's reason, value and any refund already issued.",
    value: JSON.stringify({
      page: "returns",
      filters: { status },
      openTotal: open.length,
      awaitingRefund: awaitingRefund.length,
      refundedValue,
      visibleCount: visible.length,
      rows: visible.slice(0, 25).map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        customer: r.customerName,
        product: productName(r.productId),
        reason: RETURN_REASON_LABEL[r.reason],
        detail: r.detail,
        status: r.status,
        itemValue: r.itemValue,
        refundAmount: r.refundAmount,
        ageDays: ageInDays(r.requestedAt),
      })),
    }),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Returns"
        subtitle="What is coming back, why, and what it costs to make it right."
      />

      {notice ? (
        <p role="status" className="mb-4 text-[0.7rem] text-negative">
          {notice}
        </p>
      ) : null}

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Metric label="Open" value={String(open.length)} tone="brand" />
        <Metric
          label="Awaiting refund"
          value={String(awaitingRefund.length)}
          tone={awaitingRefund.length > 0 ? "markdown" : "positive"}
        />
        <Metric label="Refunded" value={formatMoney(refundedValue)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[0.7rem] font-medium text-ink-muted">Status</span>
        {STATUS_FILTERS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setStatus(candidate)}
            className={activeSelectClass(status === candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>

      <SectionLabel>{visible.length} returns</SectionLabel>

      <Panel padded={false}>
        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nothing in this view"
              hint="Switch the status filter to All to see everything the desk has handled."
              icon={<RotateCcw className="h-5 w-5" />}
            />
          </div>
        ) : (
          <ul>
            {visible.map((request) => {
              const age = ageInDays(request.requestedAt);
              return (
                <li
                  key={request.id}
                  className="border-b border-hairline px-4 py-3 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <SkuTile
                      name={productName(request.productId)}
                      size="sm"
                      ring={request.status === "approved" ? "markdown" : null}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.8rem] font-medium text-ink">
                        {productName(request.productId)}
                        <span className="ml-2 font-normal text-ink-muted">
                          {request.customerName}
                        </span>
                      </p>
                      <p className="bw-num truncate text-[0.7rem] text-ink-muted">
                        #{request.orderNumber} · {request.detail}
                      </p>
                    </div>
                    <Pill>{RETURN_REASON_LABEL[request.reason]}</Pill>
                    <span
                      className={cn(
                        "bw-num inline-flex items-center gap-1 text-[0.72rem]",
                        age >= 7
                          ? "font-semibold text-negative"
                          : "text-ink-muted",
                      )}
                      title={`Requested ${age} days ago`}
                    >
                      <Clock className="h-3 w-3" />
                      {age}d
                    </span>
                    <span className="bw-num w-24 shrink-0 text-right text-[0.75rem] font-medium text-ink">
                      {/* Both exact: on an approved row this column is the very
                          ceiling the control below it invites, and a rounded
                          figure here would contradict that placeholder. */}
                      {request.refundAmount !== null
                        ? formatMoneyExact(request.refundAmount)
                        : refundCeilingLabel(request.itemValue)}
                    </span>
                    <Pill tone={statusTone(request.status)}>
                      {request.status}
                    </Pill>
                    {request.status === "requested" ? (
                      <span className="flex gap-1">
                        {/* Both levers disable while ANY decision on the page is
                            outstanding — the guard is the page's, not the row's.
                            See `useInFlight` above. */}
                        <button
                          type="button"
                          aria-label={`Approve the return on order ${request.orderNumber}`}
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`${request.id}:approved`, () =>
                              decide(request.id, "approved"),
                            )
                          }
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-positive hover:bg-positive-soft disabled:opacity-40"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Decline the return on order ${request.orderNumber}`}
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`${request.id}:declined`, () =>
                              decide(request.id, "declined"),
                            )
                          }
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-ink-muted hover:bg-surface-muted disabled:opacity-40"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : null}
                  </div>

                  {request.status === "approved" ? (
                    <RefundControl
                      request={request}
                      onRefund={(amount) => refund(request.id, amount)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
