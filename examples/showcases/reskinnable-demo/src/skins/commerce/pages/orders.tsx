"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Clock, MailCheck, PauseOctagon } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { useCommerceLedger } from "../data/ledger-context";
import {
  CHANNEL_LABEL,
  EXCEPTION_FILTERS,
  ORDER_EXCEPTION_LABEL,
  ORDER_STATUS_FILTERS,
  ageInDays,
  formatMoney,
  orderUnits,
  ordersOnException,
  valueAtRisk,
} from "../data/derive";
import type { ExceptionFilter, OrderSort, StatusFilter } from "../data/derive";
import type { Order, OrderException, OrderStatus } from "../data/types";
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
 * BEAT 3c — the lever surface.
 *
 * Status, exception, sort and top-N are all read from the QUERY STRING, which is
 * what lets the agent perform a maneuver instead of following a link: it
 * confirms the levers it is about to pull, navigates to
 * `?status=open&exception=any&sort=aging_desc&top=10`, and this page reads them.
 *
 * FOUR levers rather than the usual two, on purpose — "make it complicated" is
 * the note this beat came with. A single filter looks like a link with extra
 * steps; a status, an exception class, a sort and a limit applied together look
 * like someone who knows the tool.
 *
 * The controls it set are then VISIBLY highlighted (`activeSelectClass`), which
 * is the half of the beat that is easy to skip and impossible to recover: if the
 * page merely shows the right rows, the audience sees a filtered list and has to
 * take on faith that the assistant did it. Tinting the controls shows them the
 * assistant reaching into the app's real UI. Note it is the CONTROLS that light
 * up, not the rows.
 *
 * This page is also where beat 5's three writes land — the hold shows as a
 * status pill, the customer notification appears in its own panel, and the
 * forced-🚨 note is printed under the order row. All three are on one screen so
 * a stored procedure firing is something the room WATCHES rather than reads
 * about in the transcript.
 */

/**
 * Typed `Record<OrderSort, …>` against the shared lever vocabulary in `derive`,
 * so a sort `showOrderQueue` advertises with no comparator here — or a
 * comparator here the tool cannot ask for — is a type error rather than a lever
 * that silently does nothing.
 */
const SORTS: Record<
  OrderSort,
  { label: string; compare: (a: Order, b: Order) => number }
> = {
  aging_desc: {
    label: "Oldest first",
    compare: (a: Order, b: Order) => a.placedAt.localeCompare(b.placedAt),
  },
  aging_asc: {
    label: "Newest first",
    compare: (a: Order, b: Order) => b.placedAt.localeCompare(a.placedAt),
  },
  value_desc: {
    label: "Largest value",
    compare: (a: Order, b: Order) => b.total - a.total,
  },
};

type SortKey = OrderSort;

/**
 * The status controls, from the ONE list `showOrderQueue`'s schema is also built
 * from (`ORDER_STATUS_FILTERS`) — including `cancelled`, which this page shows
 * and the agent may therefore ask for. See that constant's header.
 */
const STATUSES: readonly StatusFilter[] = ORDER_STATUS_FILTERS;

const EXCEPTION_FILTER_LABEL: Record<string, string> = {
  all: "All",
  any: "Any exception",
  ...ORDER_EXCEPTION_LABEL,
};

/**
 * The `top` lever, parsed the way every other lever on this page is parsed: a
 * value this page cannot honour is IGNORED — the view renders exactly as it does
 * with the lever absent — and is never coerced into a plausible-looking limit.
 *
 * This shipped as `Math.max(1, Number(raw) || 0)`, which turned every junk value
 * into a limit of ONE: `?top=abc` → `NaN` → `|| 0` → `Math.max(1, 0)` → 1, and
 * likewise `?top=0` and `?top=-3`. A one-row queue is the worst available answer
 * for beat 3c, because it is indistinguishable on stage from a legitimately
 * narrow filter result — the claim "the assistant reached the app's real
 * controls" would then be carried by a screen nobody in the room can check.
 * Falling back to the full list is self-evident instead: the "All" control stays
 * tinted and the count reads as the unfiltered one.
 *
 * Only a positive integer is honoured. A fractional `?top=2.5` is rejected
 * rather than rounded — neither the controls (`null | 5 | 10`) nor the
 * `showOrderQueue` tool emit one, and choosing between floor and ceil would be
 * inventing a limit nobody asked for.
 */
export function parseTopLever(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const digits = raw.trim();
  // Digits only: rejects "", " ", "abc", "-3", "2.5", "1e2", "+5", "10px".
  if (!/^\d+$/.test(digits)) return null;
  const parsed = Number(digits);
  // A digit string too long to represent exactly is unusable too, and 0 is not a
  // limit. Both land on "no limit" — never on 1.
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * How many of the most recent customer notifications the page shows.
 *
 * ONE number, read by BOTH the notifications panel and the beat-3b readable via
 * the single `visibleNotifications` list below. It was two numbers — the panel
 * sliced 6 and the readable sliced 5 — so with six notifications on screen the
 * agent described five and was wrong about the visible state by exactly one row.
 * Beat 3b's whole claim is that the assistant sees what the presenter sees, and
 * an off-by-one is the version of being wrong that nobody in the room catches.
 */
const NOTIFICATION_ROWS = 6;

/**
 * Shown when a write landed but `refresh()` reported it could not re-read the
 * ledger (see its contract in `data/ledger-context`). Distinct from a REFUSAL:
 * the write did happen, only the view is behind.
 */
const STALE_LEDGER_NOTICE =
  "That went through, but this page could not be re-read afterwards — the rows below may be out of date. Reload to confirm.";

function statusTone(status: OrderStatus) {
  if (status === "fulfilled") return "positive" as const;
  if (status === "on-hold") return "negative" as const;
  if (status === "cancelled") return "neutral" as const;
  return "brand" as const;
}

/** This row's two write levers, keyed for the guard below. */
type OrderWrite = "hold" | "clear";

function OrderRow({
  order,
  rank,
  notice,
  onHold,
  onClear,
}: {
  order: Order;
  rank: number | null;
  /**
   * This ROW's refusal-or-stale-view slot. Per row, not per page: the two levers
   * here report through it, and with one page-wide slot a success on any other
   * row called `setNotice(null)` and took this row's refusal away — the refused
   * write, the one the operator most needs explained, then said nothing at all.
   */
  notice: string | null;
  /** Both resolve "did this write LAND" — see `patchOrder`. */
  onHold: () => Promise<boolean>;
  onClear: () => Promise<boolean>;
}) {
  const age = ageInDays(order.placedAt);
  const flagged = order.exception !== "none";
  /**
   * ONE write in flight per ROW — hold and clear together, not one guard each.
   *
   * The granularity is set by the MESSAGE CHANNEL (see `useInFlight`'s header):
   * both levers report into the single `notice` above, so two writes outstanding
   * together means the one that finishes last speaks for both. They also write the
   * same RECORD, which is the same race by another route — clearing the exception
   * on an order whose hold is still in flight. Rows do NOT share a guard, because
   * they do not share a slot.
   */
  const { busy, run } = useInFlight();
  /**
   * Which of this row's writes have LANDED. One-way on purpose, and never
   * cleared: a landed write normally moves the row (the status pill flips, the
   * exception pill goes) and its own lever disables on the data. The ONLY way a
   * lever is still armed after its write landed is a `refresh()` that failed — and
   * re-arming there offers the store a write it has already applied, which comes
   * back 409 and paints a refusal on an action that succeeded.
   */
  const [landed, setLanded] = useState<Record<OrderWrite, boolean>>({
    hold: false,
    clear: false,
  });

  const write = (key: OrderWrite, action: () => Promise<boolean>) =>
    void run(key, async () => {
      const ok = await action();
      if (ok) setLanded((prev) => ({ ...prev, [key]: true }));
      return ok;
    });

  return (
    <li className="border-b border-hairline px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        {rank !== null ? (
          <span className="bw-num w-5 shrink-0 text-right text-[0.7rem] font-semibold text-ink-muted">
            {rank}
          </span>
        ) : null}
        <SkuTile
          name={order.customerName}
          size="sm"
          shape="round"
          ring={flagged ? "negative" : null}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8rem] font-medium text-ink">
            <span className="bw-num text-ink-muted">#{order.number}</span>{" "}
            {order.customerName}
          </p>
          <p className="truncate text-[0.7rem] text-ink-muted">
            {CHANNEL_LABEL[order.channel]} · {order.destination} ·{" "}
            {orderUnits(order)} units
          </p>
        </div>
        {flagged ? (
          <Pill tone="negative">{ORDER_EXCEPTION_LABEL[order.exception]}</Pill>
        ) : null}
        <span
          className={cn(
            "bw-num inline-flex items-center gap-1 text-[0.72rem]",
            age >= 21 ? "font-semibold text-negative" : "text-ink-muted",
          )}
          title={`Placed ${age} days ago`}
        >
          <Clock className="h-3 w-3" />
          {age}d
        </span>
        <span className="bw-num w-20 shrink-0 text-right text-[0.75rem] font-medium text-ink">
          {formatMoney(order.total)}
        </span>
        <Pill tone={statusTone(order.status)}>{order.status}</Pill>
        {order.status === "open" || order.status === "on-hold" ? (
          <span className="flex gap-1">
            {/* Both levers disable while EITHER write on this row is
                outstanding, and a lever whose write has landed stays down. */}
            <button
              type="button"
              aria-label={`Hold order ${order.number}`}
              onClick={() => write("hold", onHold)}
              disabled={
                order.status === "on-hold" || landed.hold || busy !== null
              }
              className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-negative hover:bg-negative-soft disabled:opacity-30"
            >
              <PauseOctagon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Clear the exception on order ${order.number}`}
              onClick={() => write("clear", onClear)}
              disabled={!flagged || landed.clear || busy !== null}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-ink-muted hover:bg-surface-muted disabled:opacity-30"
            >
              <Ban className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
      </div>

      {/* This row's own place to speak. Both notices it can carry — a refusal,
          and a write that landed while the re-read did not — are about THIS
          order, so they belong beside it rather than in a page-wide slot that any
          other row can overwrite. The stale note leads with "That went through",
          which is what stops the shared negative styling from reading as "the
          write failed". */}
      {notice ? (
        <p role="status" className="mt-2 text-[0.7rem] text-negative">
          {notice}
        </p>
      ) : null}

      {/* BEAT 5, write #3. A note is only a demo beat if the room can SEE it, so
          the most recent one is printed under its order rather than hidden
          behind a detail view. The 🚨 is forced by the tool, not typed here. */}
      {order.notes[0] ? (
        <p className="mt-2 rounded-md bg-brand-soft px-2.5 py-1.5 text-[0.72rem] text-ink">
          {order.notes[0].text}
          <span className="ml-2 text-ink-muted">— {order.notes[0].author}</span>
        </p>
      ) : null}
    </li>
  );
}

export function OrdersPage() {
  const { data, refresh } = useCommerceLedger();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const params = useSearchParams();
  const [channel, setChannel] = useState<string>("all");
  /**
   * What each ROW has to say about its own last write, keyed by order id.
   *
   * The hold and clear-exception buttons print no receipt — the status pill
   * changing IS the receipt — so anything that stops the pill from moving has to
   * be said out loud or the button reads as dead. Two different things can: the
   * route REFUSING the write, and a `refresh()` that could not re-read the ledger
   * afterwards (see its contract in `data/ledger-context`). A row's slot carries
   * both.
   *
   * PER ROW, not one for the page. It was one, and every landing write cleared it
   * — so a refusal on one order was erased by an unrelated order's success, and
   * the refused write said nothing at all. Same defect, and the same fix, as the
   * per-surface slots in `pages/promotions.tsx`.
   */
  const [notices, setNotices] = useState<Record<string, string | null>>({});
  const setNotice = (id: string, message: string | null) =>
    setNotices((prev) => ({ ...prev, [id]: message }));

  // Levers that can arrive from the URL.
  const statusParam = params?.get("status") ?? null;
  const exceptionParam = params?.get("exception") ?? null;
  const sortParam = (params?.get("sort") ?? null) as SortKey | null;
  const topParam = params?.get("top") ?? null;

  // Same widening as the exception test below, for the same reason.
  const status: StatusFilter =
    statusParam && (STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as StatusFilter)
      : "all";
  // Widened to `readonly string[]` for the membership test: EXCEPTION_FILTERS is
  // a narrow const tuple, so `.includes()` would otherwise refuse an arbitrary
  // query-string value as an argument — the very thing being validated here.
  const exception: ExceptionFilter =
    exceptionParam &&
    (EXCEPTION_FILTERS as readonly string[]).includes(exceptionParam)
      ? (exceptionParam as ExceptionFilter)
      : "all";
  const sort: SortKey =
    sortParam && sortParam in SORTS ? sortParam : "aging_desc";
  const top = parseTopLever(topParam);

  const setLever = (key: string, value: string | null) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value === null) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    // Through skinHref, never a hardcoded `/commerce` — under LOCK_SKIN the
    // deploy is served at `/` and a literal prefix reappears in the address bar
    // on the first click.
    router.push(`${skinHref()}${query ? `?${query}` : ""}`);
  };

  /**
   * ONE pipeline, TWO published lengths.
   *
   *  - `matching` — every row the levers admit, sorted, BEFORE the top-N limit.
   *  - `visible`  — `matching` after the limit: exactly the rows rendered.
   *
   * Both come out of the same `useMemo` because they are the same derivation
   * observed at two points, and the count caption below is the one number on
   * screen that has to agree with the rows. It read
   * `of ${data.orders.length}` — the WHOLE book — so
   * `?status=open&exception=any&top=10` printed "Top 10 of 22" against 13
   * matching rows. Beat 3c's entire claim is that the assistant set real
   * filters; a denominator that ignores them tells the room the filters did
   * nothing, in the one figure the audience is being asked to read. Deriving
   * both here is what stops that recurring — a second `data.orders.filter(…)`
   * next to the label is how it happened the first time.
   */
  const { matching, visible } = useMemo(() => {
    const rows = data.orders
      .filter((o) => {
        if (status !== "all" && o.status !== status) return false;
        if (exception === "any" && o.exception === "none") return false;
        if (
          exception !== "all" &&
          exception !== "any" &&
          o.exception !== exception
        )
          return false;
        if (channel !== "all" && o.channel !== channel) return false;
        return true;
      })
      // `filter` already returned a fresh array, so sorting it in place mutates
      // nothing the ledger owns.
      .sort(SORTS[sort].compare);
    return { matching: rows, visible: top ? rows.slice(0, top) : rows };
  }, [data.orders, status, exception, channel, sort, top]);

  /**
   * Both order controls write through here, so neither can drift from the other
   * on the half that is easy to forget: a refused PATCH has to SAY so.
   *
   * Both of these used to call `refresh()` unconditionally, which repainted the
   * identical rows on a 4xx — a click that did nothing, indistinguishable on
   * stage from a slow network. That is no longer a theoretical branch: the route
   * now runs every order write through the state machine in
   * `store.orderStatusBlocker`, so a hold can legitimately come back 409
   * (`ORDER_ALREADY_SETTLED`, `ILLEGAL_ORDER_TRANSITION`) and a clear can come
   * back 422 (`EXCEPTION_ON_SETTLED_ORDER`) — for instance when the row on
   * screen was fulfilled by someone else since the last snapshot.
   *
   * The route's own `message` is preferred over the fallback because those
   * strings are written to be read by a human (`data/http.ts`), and a refusal the
   * UI paraphrases into "it failed" is a refusal the room learns nothing from.
   *
   * TOTAL: a `fetch` that never answers at all is reported here rather than
   * thrown. It used to throw straight out of the click handler as an unhandled
   * rejection, so an offline browser or a dev server restarted mid-call took beat
   * 5's first write with it and left the page silent.
   *
   * Resolves "did this write LAND", which is what the row's lever locks on. It is
   * NOT "and the page now shows it": a landed write whose `refresh()` failed still
   * resolves `true` and leaves the stale-view notice up — the same split
   * `settle.ts`'s `staleNote` makes for the chat receipts. Reading that case as a
   * refusal is what re-arms a lever over a write the store has already applied.
   */
  const patchOrder = async (
    id: string,
    body: { status?: OrderStatus; exception?: OrderException },
    fallback: string,
  ): Promise<boolean> => {
    let res: Response;
    try {
      res = await fetch(`/api/commerce/v1/orders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      setNotice(
        id,
        `${fallback}: ${describeError(error)}. ` +
          "Nothing came back, so treat it as not applied.",
      );
      return false;
    }
    if (!res.ok) {
      const problem = await res.json().catch(() => ({}));
      setNotice(id, problem?.message ?? `${fallback} (${res.status}).`);
      return false;
    }
    setNotice(id, (await refresh()) ? null : STALE_LEDGER_NOTICE);
    return true;
  };

  const hold = (id: string) =>
    patchOrder(id, { status: "on-hold" }, "That order could not be held");

  // Clears the exception and NOTHING else. This used to also send
  // `status: "open"`, which meant clearing the flag on an order beat 5 had just
  // put on hold quietly RELEASED the hold — the first of the procedure's three
  // writes vanished, and the button's label never said it would. The status is
  // absent from the body rather than echoed back from `order.status`: echoing is
  // a read-modify-write against a snapshot that may already be stale, and it
  // would still be asserting a status this control has no business asserting.
  const clearException = (id: string) =>
    patchOrder(
      id,
      { exception: "none" },
      "That exception could not be cleared",
    );

  // The notification rows on screen. Derived ONCE, here, so the panel below and
  // the readable cannot slice the same list to two different lengths.
  const visibleNotifications = useMemo(
    () => data.notifications.slice(0, NOTIFICATION_ROWS),
    [data.notifications],
  );

  const onException = ordersOnException(data.orders);
  const atRisk = valueAtRisk(data.orders);
  const oldest = onException.length
    ? Math.max(...onException.map((o) => ageInDays(o.placedAt)))
    : 0;

  const orderNumber = (id: string) =>
    data.orders.find((o) => o.id === id)?.number ?? id;

  // ── BEAT 3b ──────────────────────────────────────────────────────────────
  // The active levers AND the rows actually rendered after filtering, sorting
  // and slicing — in the order shown. Asked "what's on my screen?" here, the
  // agent must be able to say "the ten oldest orders still on an exception,
  // Ines's oversell at the top, 34 days old" and be right about all of it.
  //
  // THE RULE, and the one thing to preserve when editing this readable: every
  // list below is the SAME expression the corresponding panel renders — `visible`
  // for the queue, `visibleNotifications` for the notification log — never a
  // second slice of the same source. Both used to carry their own limit (`visible
  // .slice(0, 25)`, `notifications.slice(0, 5)` against a panel showing 6), which
  // makes the readable disagree with the screen it claims to describe and quietly
  // falsifies the beat. A cap here would have to be a cap the panel applies too.
  //
  // The figures are split by SCOPE, and the keys say which is which. They used
  // to sit flat — `ordersOnException` and `valueAtRisk`, both book-wide, beside
  // `filters` and `visibleCount` — under a description promising "the page the
  // user is currently viewing", so an agent asked what was on screen could
  // truthfully read 15 exceptions off a queue showing 10 rows. Same hazard as the
  // count caption's denominator, one layer down: a book-wide number presented as
  // a description of the filtered view.
  //
  // `matchingCount` is the caption's denominator, off the same `matching` list
  // the caption prints, so the agent can state the figure the room is reading.
  useAgentContext({
    description:
      "The Orders page the user is currently viewing. `filters` are the active " +
      "status, exception and channel filters plus the sort order and top-N " +
      "limit; `matchingCount` is how many orders those filters admit before the " +
      "limit and `visibleCount` how many `rows` remain after it (the rows " +
      "actually on screen, in the order shown); `book` holds whole-ledger " +
      "totals that the filters do NOT narrow — never report those as the " +
      "contents of this view.",
    value: JSON.stringify({
      page: "orders",
      filters: { status, exception, channel, sort, top },
      book: {
        totalOrders: data.orders.length,
        ordersOnException: onException.length,
        valueAtRisk: atRisk,
        oldestExceptionAgeDays: oldest,
      },
      matchingCount: matching.length,
      visibleCount: visible.length,
      rows: visible.map((o) => ({
        id: o.id,
        number: o.number,
        customer: o.customerName,
        channel: CHANNEL_LABEL[o.channel],
        destination: o.destination,
        status: o.status,
        exception: ORDER_EXCEPTION_LABEL[o.exception],
        ageDays: ageInDays(o.placedAt),
        total: o.total,
        units: orderUnits(o),
        latestNote: o.notes[0]?.text ?? null,
      })),
      recentNotifications: visibleNotifications.map((n) => ({
        order: orderNumber(n.orderId),
        template: n.template,
      })),
    }),
  });

  const showRank = sort === "aging_desc" || sort === "value_desc";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Orders"
        subtitle="The exception queue first — everything the desk has to touch before it ships."
      />

      {/* THE OTHER FOUR NUMBERS ON THIS PAGE, and why they are NOT view-scoped.
          All four are computed off the full ledger, and they stay that way:
          `ordersOnException` / `valueAtRisk` are the shared derivations the a2ui
          brief's StatCards and the OGUI sandbox KPIs publish off the same
          snapshot (see their headers in `data/derive.ts`), and those panels sit
          on the canvas BESIDE these cards. Filtering them here would put two
          different answers to one question on screen at once — the exact defect
          that file exists to prevent. So the scope is stated instead of changed:
          this caption is what stops a book-wide figure from being read as a
          description of the filtered queue below, which is the hazard the
          "Top N of X" denominator actually fell into. */}
      <SectionLabel>The whole order book</SectionLabel>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Open"
          value={String(data.orders.filter((o) => o.status === "open").length)}
          tone="brand"
        />
        <Metric
          label="On exception"
          value={String(onException.length)}
          tone={onException.length > 0 ? "negative" : "positive"}
        />
        <Metric label="Value at risk" value={formatMoney(atRisk)} />
        <Metric
          label="Oldest exception"
          value={`${oldest}d`}
          tone={oldest >= 21 ? "negative" : "neutral"}
        />
      </div>

      <Panel className="mb-4" padded={false}>
        <div className="flex flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.7rem] font-medium text-ink-muted">
              Status
            </span>
            {STATUSES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() =>
                  setLever("status", candidate === "all" ? null : candidate)
                }
                className={activeSelectClass(status === candidate)}
              >
                {candidate}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.7rem] font-medium text-ink-muted">
              Exception
            </span>
            {EXCEPTION_FILTERS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() =>
                  setLever("exception", candidate === "all" ? null : candidate)
                }
                className={activeSelectClass(exception === candidate)}
              >
                {EXCEPTION_FILTER_LABEL[candidate]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[0.7rem] font-medium text-ink-muted">
              Sort
            </span>
            {(Object.keys(SORTS) as SortKey[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setLever("sort", candidate)}
                className={activeSelectClass(sort === candidate)}
              >
                {SORTS[candidate].label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[0.7rem] font-medium text-ink-muted">
              Show
            </span>
            {[null, 5, 10].map((candidate) => (
              <button
                key={String(candidate)}
                type="button"
                onClick={() =>
                  setLever("top", candidate === null ? null : String(candidate))
                }
                className={activeSelectClass(top === candidate)}
              >
                {candidate === null ? "All" : `Top ${candidate}`}
              </button>
            ))}
          </div>

          <label className="ml-auto flex items-center gap-1.5">
            <span className="text-[0.7rem] font-medium text-ink-muted">
              Channel
            </span>
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              className="rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.78rem] text-ink outline-none focus:border-brand/50"
            >
              <option value="all">All channels</option>
              {Object.entries(CHANNEL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      {/* Numerator and denominator BOTH off the one pipeline above: `visible` is
          what the queue renders, `matching` is what the levers admit before the
          limit. `Math.min(top, …)` is gone with the bug — `visible` is already
          sliced, so its own length is the honest numerator. */}
      <SectionLabel>
        {top
          ? `Top ${visible.length} of ${matching.length}`
          : `${visible.length} orders`}
      </SectionLabel>

      <Panel padded={false}>
        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nothing in this view"
              hint="Widen the status or exception filter, or clear the top-N limit, to see the rest of the book."
            />
          </div>
        ) : (
          <ul>
            {visible.map((order, index) => (
              <OrderRow
                key={order.id}
                order={order}
                rank={showRank ? index + 1 : null}
                notice={notices[order.id] ?? null}
                onHold={() => hold(order.id)}
                onClear={() => clearException(order.id)}
              />
            ))}
          </ul>
        )}
      </Panel>

      {/* BEAT 5, write #2. A notification that only exists as a sentence in the
          transcript is a step the room has to take on trust, so the ones the app
          sends are listed here — the most recent NOTIFICATION_ROWS of them, and
          the readable above describes exactly this list. */}
      <div className="mt-6">
        <SectionLabel>Customer notifications</SectionLabel>
        <Panel padded={false}>
          {visibleNotifications.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No notifications sent yet"
                hint="Holding an order for verification sends the customer a message, and it is logged here."
                icon={<MailCheck className="h-5 w-5" />}
              />
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {visibleNotifications.map((notification) => (
                <li
                  key={notification.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <MailCheck className="h-4 w-4 shrink-0 text-positive" />
                  <span className="bw-num shrink-0 text-[0.74rem] font-medium text-ink">
                    #{orderNumber(notification.orderId)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.76rem] text-ink">
                    {notification.template}
                  </span>
                  <span className="shrink-0 text-[0.68rem] text-ink-muted">
                    {notification.sentBy}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
