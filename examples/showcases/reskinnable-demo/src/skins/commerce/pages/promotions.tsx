"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Tag, X } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useCommerceLedger } from "../data/ledger-context";
import {
  FLOOR_WORKLIST_RANK,
  countBelow,
  discountedPrice,
  formatMargin,
  formatMoney,
  formatMoneyExact,
  noMarkdownFloorCaveat,
  nullableBelowFloor,
  promotionFloorStatus,
  promotionMargin,
  tallyStatuses,
  windowLabel,
} from "../data/derive";
import type { FloorStatus } from "../data/derive";
import {
  JUSTIFICATION_MAX_LENGTH,
  MARGIN_WAIVER_CODES,
  waiverCodeLabel,
} from "../data/waiver-codes";
import type { MarginWaiver, Product, Promotion } from "../data/types";
import { useRecording } from "@/shell/teach";
import { SkuTile } from "../components/sku-tile";
import { useInFlight } from "../components/use-in-flight";
import type { InFlight } from "../components/use-in-flight";
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
 * BEAT 6 — the demonstration surface.
 *
 * This is the page a merchandiser is standing on when they show Bellwether how
 * to get a below-floor markdown approved. Everything the unlock needs is real UI
 * here — file a waiver under a code, finalize it, approve — and every one of
 * those three actions calls `recording.logStep`, so the agent's waiting card
 * narrates the demonstration as it happens.
 *
 * The waiver code goes into the recording as DATA (`logStep(label, code)`), not
 * just as prose, because the whole point of the beat is that the saved procedure
 * names the code that ACTUALLY WORKED. If the merchandiser picks a decoy, that
 * decoy is what gets recorded and the approve still fails — an honest outcome,
 * and a far better demo than a recorder that quietly corrects them.
 *
 * Note what this page does NOT do: it never marks the justifying codes. The
 * catalogue in `data/waiver-codes.ts` is deliberately mixed and its blurbs never
 * say whether a code lifts the gate. An agent reading this page's DOM learns the
 * options, not the answer.
 */

const STATUS_FILTERS = ["all", "pending", "approved", "declined"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * A card's two WRITE SURFACES: the decision levers, and the waiver panel.
 *
 * They are separate message channels because they used to be one. Both wrote
 * `errors[promotion.id]`, so a successful filing's `setError(id, null)` erased the
 * refusal an approve had just printed and the refused approve — the one write the
 * merchandiser most needs explained — ended up saying nothing. A per-surface mutex
 * does not help when the CHANNEL is shared, and a shared channel is not fixed by a
 * coarser mutex either: this skin needed both, and this type is the second half.
 */
type WriteSurface = "decision" | "waiver";

/** Where a surface's refusal or stale-view note is kept, per promotion. */
const slot = (id: string, surface: WriteSurface) => `${id}:${surface}`;

function statusTone(status: Promotion["status"]) {
  if (status === "approved") return "positive" as const;
  if (status === "declined") return "neutral" as const;
  return "markdown" as const;
}

function WaiverPanel({
  promotion,
  waivers,
  error,
  guard,
  onFile,
  onFinalize,
}: {
  promotion: Promotion;
  waivers: MarginWaiver[];
  error: string | null;
  /**
   * The CARD's guard, handed down rather than mounted here.
   *
   * This panel used to hold its own instance, which meant a filing could start
   * while the card's approve was still outstanding — two writes against the same
   * markdown, reporting into the same slot. See `PromotionCard`.
   */
  guard: InFlight;
  onFile: (code: string, justification: string) => Promise<boolean>;
  onFinalize: (waiverId: string) => Promise<boolean>;
}) {
  const [code, setCode] = useState(MARGIN_WAIVER_CODES[0].code);
  const [justification, setJustification] = useState("");
  const { busy, run } = guard;

  const blurb = MARGIN_WAIVER_CODES.find((c) => c.code === code)?.blurb ?? "";

  return (
    <div className="mt-3 rounded-md border border-hairline bg-surface-muted p-3">
      <SectionLabel>Margin waivers</SectionLabel>

      {waivers.length > 0 ? (
        <ul className="mb-3 divide-y divide-hairline">
          {waivers.map((waiver) => (
            <li
              key={waiver.id}
              className="flex flex-wrap items-center gap-2 py-1.5"
            >
              <Pill
                tone={waiver.status === "approved" ? "positive" : "neutral"}
              >
                {waiver.code}
              </Pill>
              <span className="min-w-0 flex-1 truncate text-[0.72rem] text-ink-muted">
                {waiverCodeLabel(waiver.code)}
                {waiver.justification ? ` — ${waiver.justification}` : ""}
              </span>
              {waiver.status === "draft" ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(waiver.id, () => onFinalize(waiver.id))
                  }
                  className="rounded-md bg-brand px-2.5 py-1 text-[0.7rem] font-semibold text-brand-foreground disabled:opacity-40"
                >
                  {busy === waiver.id ? "Finalizing…" : "Finalize"}
                </button>
              ) : (
                <span className="text-[0.68rem] font-medium text-positive">
                  finalized
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[10rem] flex-1">
          <span className="mb-1 block text-[0.68rem] font-medium text-ink-muted">
            Waiver code
          </span>
          <select
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.76rem] text-ink outline-none focus:border-brand/50"
          >
            {MARGIN_WAIVER_CODES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.code} — {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[12rem] flex-[2]">
          <span className="mb-1 block text-[0.68rem] font-medium text-ink-muted">
            Justification
          </span>
          <input
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            // Bounded here as well as in the store, so the merchandiser cannot
            // type a filing the API will only refuse after the round-trip.
            maxLength={JUSTIFICATION_MAX_LENGTH}
            placeholder="What is on file?"
            className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.76rem] text-ink outline-none focus:border-brand/50"
          />
        </label>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run("file", async () => {
              const filed = await onFile(code, justification);
              // ONLY a filing that actually landed may take the sentence away.
              // A refusal leaves it typed: `INVALID_JUSTIFICATION` on a
              // too-short one is now an ORDINARY case, and `ALREADY_DECIDED` /
              // `INVALID_WAIVER_CODE` are reachable too — so the merchandiser
              // fixes the code and re-files instead of retyping on stage.
              if (filed) setJustification("");
              return filed;
            })
          }
          className="rounded-md border border-brand/40 bg-brand-soft px-3 py-1.5 text-[0.75rem] font-semibold text-brand disabled:opacity-40"
        >
          {busy === "file" ? "Filing…" : "File waiver"}
        </button>
      </div>
      {/* The WAIVER surface's own message slot. It used to share the card's, so a
          successful filing's `setError(id, null)` took away the refusal the
          decision levers had just printed — and a refused approve then said
          nothing at all. Each surface speaks only about itself. */}
      {error ? (
        <p className="mt-2 rounded-md border border-negative/30 bg-negative-soft px-2.5 py-1.5 text-[0.73rem] text-negative">
          {error}
        </p>
      ) : null}
      <p className="mt-1.5 text-[0.66rem] text-ink-muted">{blurb}</p>
      <p className="mt-1 text-[0.66rem] text-ink-muted">
        A filed waiver has to be finalized before trading policy will look at
        it. Not every code clears the floor — {promotion.name} still has to pass
        the approval check afterwards.
      </p>
    </div>
  );
}

function PromotionCard({
  promotion,
  product,
  floor,
  status,
  waivers,
  decisionError,
  waiverError,
  onApprove,
  onDecline,
  onFile,
  onFinalize,
}: {
  promotion: Promotion;
  product: Product | undefined;
  floor: number | null;
  /**
   * The card's ONE floor verdict, derived by the page from
   * `derive.promotionFloorStatus` and handed down.
   *
   * It used to be computed here as `margin < floor` ending `: false`, so a
   * markdown whose category had no floor on file rendered as a cleared one — the
   * green margin, no caveat, and (because the waiver desk keys off the same flag)
   * no sign that anything was unresolved. `"unknown"` is a state this card has to
   * SAY, not a falsy default.
   */
  status: FloorStatus;
  waivers: MarginWaiver[];
  decisionError: string | null;
  waiverError: string | null;
  onApprove: () => Promise<boolean>;
  onDecline: () => Promise<boolean>;
  onFile: (code: string, justification: string) => Promise<boolean>;
  onFinalize: (waiverId: string) => Promise<boolean>;
}) {
  /**
   * ONE guard for this whole card — approve, decline, file and finalize.
   *
   * Approve and decline are two decisions on the SAME markdown, and the store
   * settles it once (`ALREADY_DECIDED`), so letting the second start would only
   * ever produce a refusal for a decision that landed. The waiver panel is on the
   * same instance for two reasons: its levers write the same RECORD (filing a
   * waiver on a markdown that is being decided is that race by another route), and
   * its outcomes land on the same card, where a write finishing second used to
   * speak for a write that had already reported.
   */
  const guard = useInFlight();
  const { busy, run } = guard;
  const price = product
    ? discountedPrice(product.listPrice, promotion.discountPercent)
    : null;
  const margin = promotionMargin(product, promotion);
  const belowFloor = status === "below";
  /** Measurable margin, no floor to measure it against. NOT an all-clear. */
  const unchecked = status === "unknown";

  return (
    <Panel>
      <div className="flex items-start gap-3">
        <SkuTile
          name={product?.name ?? promotion.name}
          size="lg"
          ring={belowFloor ? "negative" : "markdown"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">
              {promotion.name}
            </p>
            <Pill tone={statusTone(promotion.status)}>{promotion.status}</Pill>
            <Pill tone="markdown">−{promotion.discountPercent}%</Pill>
          </div>
          <p className="mt-0.5 truncate text-[0.72rem] text-ink-muted">
            {product?.name ?? "Unknown product"} · {product?.category ?? "—"} ·{" "}
            {windowLabel(promotion.startsAt, promotion.endsAt)} · raised by{" "}
            {promotion.submittedBy}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="bw-num text-[0.74rem] text-ink-muted">
              List{" "}
              <span className="font-medium text-ink">
                {product ? formatMoney(product.listPrice) : "—"}
              </span>
            </span>
            <span className="bw-num text-[0.74rem] text-ink-muted">
              Markdown{" "}
              <span className="font-medium text-brand-violet">
                {price === null ? "—" : formatMoneyExact(price)}
              </span>
            </span>
            <span className="bw-num text-[0.74rem] text-ink-muted">
              Margin{" "}
              {/* THREE colours, because green is an assertion. A markdown with
                  no floor on file has cleared nothing, so it gets ordinary ink —
                  the same stance `tools.tsx`'s neutral floor pill and the
                  catalog's row take. */}
              <span
                className={cn(
                  "font-semibold",
                  belowFloor
                    ? "text-negative"
                    : unchecked
                      ? "text-ink"
                      : "text-positive",
                )}
              >
                {margin === null ? "—" : formatMargin(margin)}
              </span>
              {floor !== null ? (
                <span className="ml-1 text-ink-muted">
                  vs floor {formatMargin(floor)}
                </span>
              ) : (
                <span className="ml-1 text-ink-muted">· no floor on file</span>
              )}
            </span>
          </div>

          {/* An unmeasurable markdown says so, in ink rather than in alarm
              colours: it is not a violation and it is not a clearance. Without
              this line the row is a bare percentage, which reads as "checked,
              fine" — the exact false all-clear `derive.FloorStatus` exists to
              stop. */}
          {unchecked ? (
            <p className="mt-2.5 rounded-md border border-hairline bg-surface-muted px-2.5 py-1.5 text-[0.73rem] text-ink-muted">
              No margin floor on file for {product?.category ?? "this category"}{" "}
              — this markdown has NOT been checked against one.
            </p>
          ) : null}

          {belowFloor ? (
            <p className="mt-2.5 flex items-start gap-1.5 rounded-md border border-negative/30 bg-negative-soft px-2.5 py-1.5 text-[0.73rem] text-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-negative" />
              <span>
                This markdown trades{" "}
                <strong className="bw-num">
                  {formatMargin((floor as number) - (margin as number)).replace(
                    "%",
                    "",
                  )}
                  pt
                </strong>{" "}
                under the {product?.category} floor.
              </span>
            </p>
          ) : null}

          {/* The DECISION surface's message slot — approve and decline, and
              nothing else. */}
          {decisionError ? (
            <p className="mt-2 rounded-md border border-negative/30 bg-negative-soft px-2.5 py-1.5 text-[0.73rem] text-negative">
              {decisionError}
            </p>
          ) : null}

          {promotion.status === "pending" ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("approve", onApprove)}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("decline", onDecline)}
                className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
                {busy === "decline" ? "Declining…" : "Decline"}
              </button>
            </div>
          ) : null}

          {/* The waiver desk only appears where it is relevant — on a pending
              markdown that is actually under its floor. Showing it everywhere
              would turn the unlock into ambient UI the agent could read as an
              obvious next step, which is precisely what beat 6 needs it not to
              be.
              `belowFloor` and not `!clear`, deliberately: the desk is premised on
              a CONFIRMED violation, and an unmeasurable markdown has none to
              waive — the server refuses its category outright
              (`store.floorFor` throws `UNKNOWN_CATEGORY`), so a waiver filed
              against it could not unlock anything. That row gets the caveat above
              instead, which is information rather than a dead lever. */}
          {promotion.status === "pending" && belowFloor ? (
            <WaiverPanel
              promotion={promotion}
              waivers={waivers}
              error={waiverError}
              guard={guard}
              onFile={onFile}
              onFinalize={onFinalize}
            />
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

export function PromotionsPage() {
  const { data, refresh } = useCommerceLedger();
  const recording = useRecording();
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const productOf = (promotion: Promotion) =>
    data.products.find((p) => p.id === promotion.productId);
  const floorOf = (promotion: Promotion) => {
    const item = productOf(promotion);
    if (!item) return null;
    return data.floors.find((f) => f.category === item.category)?.floor ?? null;
  };
  /**
   * THE page's one floor verdict per markdown. Every surface below — the sort, the
   * KPI tile, each card and the readable — reads this, so none of them can decide
   * the question locally and land on `false` for a markdown nobody checked.
   */
  const floorStatusOf = (promotion: Promotion): FloorStatus =>
    promotionFloorStatus(data.floors, productOf(promotion), promotion);

  const visible = useMemo(() => {
    const rows = data.promotions.filter(
      (p) => status === "all" || p.status === status,
    );
    // Below-floor first, then the ones that could not be checked, then the rest —
    // the shared worklist rank, so this desk and the catalog agree about where an
    // unmeasurable row belongs. It used to score `!item || floor === null` as `1`,
    // i.e. as CLEAN, which buried the one row nobody has verified underneath the
    // rows that were.
    return [...rows].sort(
      (a, b) =>
        FLOOR_WORKLIST_RANK[floorStatusOf(a)] -
        FLOOR_WORKLIST_RANK[floorStatusOf(b)],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.promotions, data.products, data.floors, status]);

  const setError = (
    id: string,
    surface: WriteSurface,
    message: string | null,
  ) => setErrors((prev) => ({ ...prev, [slot(id, surface)]: message }));

  /**
   * The write landed but `refresh()` reported it could not re-read the ledger
   * (see its contract in `data/ledger-context`). Without this the row keeps its
   * old status and the page just looks like nothing happened.
   */
  const setStaleIfNeeded = (
    id: string,
    surface: WriteSurface,
    refreshed: boolean,
  ) => {
    if (!refreshed) {
      setError(
        id,
        surface,
        "Done, but the page could not be re-read — reload it.",
      );
    }
  };

  /**
   * Every write below resolves "did this write LAND" — `false` on a refusal,
   * `true` once the store has it. It is not "and the page now shows it": a
   * landed write whose ledger re-read failed still resolves `true` and leaves the
   * stale-view notice up, because the thing the caller decides with this is
   * whether it may throw away what the user typed.
   */
  const approve = async (promotion: Promotion): Promise<boolean> => {
    const res = await fetch(
      `/api/commerce/v1/promotions/${promotion.id}/approve`,
      { method: "POST" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        promotion.id,
        "decision",
        body?.message ?? `Approval refused (${res.status}).`,
      );
      recording.logStep(`Tried to approve ${promotion.name} — refused`);
      return false;
    }
    setError(promotion.id, "decision", null);
    recording.logStep(`Approved the markdown on ${promotion.name}`);
    setStaleIfNeeded(promotion.id, "decision", await refresh());
    return true;
  };

  /**
   * The mirror of `approve`, refusal handling included. `store.declinePromotion`
   * throws `ALREADY_DECIDED` (409) for a markdown someone else has already
   * settled and `NOT_FOUND` (404) after a presenter reset; this used to
   * `refresh()` regardless and log a "Declined …" step for a decline that never
   * happened — a lie in the recording as well as a dead-looking button.
   */
  const decline = async (promotion: Promotion): Promise<boolean> => {
    const res = await fetch(
      `/api/commerce/v1/promotions/${promotion.id}/decline`,
      { method: "POST" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        promotion.id,
        "decision",
        body?.message ?? `Decline refused (${res.status}).`,
      );
      recording.logStep(`Tried to decline ${promotion.name} — refused`);
      return false;
    }
    setError(promotion.id, "decision", null);
    recording.logStep(`Declined ${promotion.name}`);
    setStaleIfNeeded(promotion.id, "decision", await refresh());
    return true;
  };

  const fileWaiver = async (
    promotion: Promotion,
    code: string,
    justification: string,
  ): Promise<boolean> => {
    const res = await fetch("/api/commerce/v1/margin-waivers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        promotionId: promotion.id,
        code,
        justification,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        promotion.id,
        "waiver",
        body?.message ?? `Could not file (${res.status}).`,
      );
      return false;
    }
    setError(promotion.id, "waiver", null);
    // The CODE rides along as data, not just inside the label — this is what
    // `getDemonstratedCode()` reads, and therefore what the saved procedure
    // ends up naming.
    recording.logStep(
      `Filed a ${code} margin waiver on ${promotion.name}`,
      code,
    );
    setStaleIfNeeded(promotion.id, "waiver", await refresh());
    return true;
  };

  const finalizeWaiver = async (
    promotion: Promotion,
    waiverId: string,
  ): Promise<boolean> => {
    const res = await fetch(
      `/api/commerce/v1/margin-waivers/${waiverId}/finalize`,
      { method: "POST" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        promotion.id,
        "waiver",
        body?.message ?? `Could not finalize (${res.status}).`,
      );
      return false;
    }
    setError(promotion.id, "waiver", null);
    recording.logStep(`Finalized the ${body?.code ?? ""} waiver`.trim());
    setStaleIfNeeded(promotion.id, "waiver", await refresh());
    return true;
  };

  const pending = data.promotions.filter((p) => p.status === "pending");
  /**
   * The pending desk's floor tally, and the headline figure it can actually
   * defend. `countBelow` returns `null` the moment one pending markdown could not
   * be checked — this used to be a `.filter(...)` whose predicate returned `false`
   * for that case, so the "Break the floor" tile printed a GREEN ZERO meaning
   * "we did not look" next to a card the same page was refusing to verify.
   */
  const pendingTally = tallyStatuses(pending.map(floorStatusOf));
  const pendingBelowFloor = countBelow(pendingTally);
  const pendingFloorCaveat = noMarkdownFloorCaveat(pendingTally.unknown);

  // ── BEAT 3b ──────────────────────────────────────────────────────────────
  useAgentContext({
    description:
      "The Promotions page the user is currently viewing: the active status " +
      "filter and the markdown rows actually visible on screen, each with the " +
      "margin it would trade at after its discount and whether that breaks the " +
      "category floor. `book` holds whole-ledger pending totals that the status " +
      "filter does NOT narrow — never report those as the contents of this " +
      "view. A row's `belowFloor` is null when its category has no margin floor " +
      "on file: that markdown was NOT checked, which is not the same as clear, " +
      "and `book.pendingBelowFloor` is null for the same reason whenever " +
      "`book.pendingWithNoFloorOnFile` is above zero.",
    value: JSON.stringify({
      page: "promotions",
      filters: { status },
      book: {
        pendingTotal: pending.length,
        pendingBelowFloor,
        pendingWithNoFloorOnFile: pendingTally.unknown,
      },
      visibleCount: visible.length,
      rows: visible.slice(0, 25).map((promotion) => {
        const item = productOf(promotion);
        const floor = floorOf(promotion);
        const price = item
          ? discountedPrice(item.listPrice, promotion.discountPercent)
          : null;
        const margin = promotionMargin(item, promotion);
        return {
          id: promotion.id,
          name: promotion.name,
          product: item?.name ?? null,
          category: item?.category ?? null,
          discountPercent: promotion.discountPercent,
          markdownPrice: price,
          margin: margin === null ? null : formatMargin(margin),
          floor: floor === null ? null : formatMargin(floor),
          // `null`, never `false`, when there is no floor to compare against:
          // a model handed `false` says the markdown is fine, which is the false
          // all-clear one layer down from the screen.
          belowFloor: nullableBelowFloor(floorStatusOf(promotion)),
          status: promotion.status,
          waivers: data.waivers
            .filter((w) => w.promotionId === promotion.id)
            .map((w) => ({ code: w.code, status: w.status })),
        };
      }),
    }),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Promotions"
        subtitle="Markdowns waiting on a decision, and what each one does to margin."
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Metric
          label="Pending"
          value={String(pending.length)}
          tone="markdown"
        />
        {/* An em dash, never a green zero, when a pending markdown could not be
            checked: this tile is the desk's all-clear and it may only show one
            when there is one. Mirrors the Catalog's "Below floor" tile exactly. */}
        <Metric
          label="Break the floor"
          value={pendingBelowFloor === null ? "—" : String(pendingBelowFloor)}
          hint={pendingFloorCaveat ?? undefined}
          tone={
            pendingBelowFloor === null || pendingBelowFloor > 0
              ? "negative"
              : "positive"
          }
        />
        <Metric
          label="Live this month"
          value={String(
            data.promotions.filter((p) => p.status === "approved").length,
          )}
        />
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

      {visible.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing in this view"
            hint="Switch the status filter to All to see every markdown the desk has looked at."
            icon={<Tag className="h-5 w-5" />}
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {visible.map((promotion) => (
            <PromotionCard
              key={promotion.id}
              promotion={promotion}
              product={productOf(promotion)}
              floor={floorOf(promotion)}
              status={floorStatusOf(promotion)}
              waivers={data.waivers.filter(
                (w) => w.promotionId === promotion.id,
              )}
              decisionError={errors[slot(promotion.id, "decision")] ?? null}
              waiverError={errors[slot(promotion.id, "waiver")] ?? null}
              onApprove={() => approve(promotion)}
              onDecline={() => decline(promotion)}
              onFile={(code, justification) =>
                fileWaiver(promotion, code, justification)
              }
              onFinalize={(waiverId) => finalizeWaiver(promotion, waiverId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
