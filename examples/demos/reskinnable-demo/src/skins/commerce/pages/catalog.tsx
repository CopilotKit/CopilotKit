"use client";

import { useMemo, useState } from "react";
import { FileText, PackageSearch } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useCommerceLedger } from "../data/ledger-context";
import {
  CATEGORY_ORDER,
  FLOOR_WORKLIST_RANK,
  belowFloorCount,
  formatMargin,
  formatMoney,
  noFloorCaveat,
  nullableBelowFloor,
  productFloorStatus,
  productMargin,
  tallyFloorStatus,
  weeksOfCover,
} from "../data/derive";
import type { FloorStatus } from "../data/derive";
import type { Product } from "../data/types";
import { keyedList } from "../components/list-keys";
import { MarginLadder } from "../components/margin-ladder";
import { SkuTile } from "../components/sku-tile";
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
 * The range, and the margin ladder it is read through.
 *
 * This page carries two beats. It is where beat 1's signature visual actually
 * lives full-size (the chat renders the compact variant of the same component),
 * and it is where beat 3d's durable artifact lands: a restock plan filed from an
 * uploaded vendor price sheet appears in the Plans panel at the bottom, keyed to
 * the APPLICATION and not to the conversation. Delete the thread and it is still
 * here, which is the entire claim that beat makes.
 */

/**
 * Below-floor first, then anything that could NOT be checked, then the rest by
 * margin ascending. The page is a worklist, so both kinds of SKU that need a
 * decision sit at the top of it — an unchecked SKU is not a clean one.
 *
 * The rank itself is `derive.FLOOR_WORKLIST_RANK`, shared with the promotions
 * desk's card order: two worklists ranking the same three verdicts must not each
 * decide where an unmeasurable row belongs.
 */

function ProductRow({
  item,
  status,
  floor,
}: {
  item: Product;
  status: FloorStatus;
  floor: number | null;
}) {
  const margin = productMargin(item);
  const cover = weeksOfCover(item);
  const belowFloor = status === "below";
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
      <SkuTile
        name={item.name}
        size="sm"
        ring={belowFloor ? "negative" : null}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8rem] font-medium text-ink">
          {item.name}
        </p>
        <p className="bw-num truncate text-[0.7rem] text-ink-muted">
          {item.sku} · {item.category} · {item.vendor}
        </p>
      </div>
      <span className="bw-num w-16 shrink-0 text-right text-[0.75rem] text-ink">
        {formatMoney(item.listPrice)}
      </span>
      <span className="bw-num w-16 shrink-0 text-right text-[0.72rem] text-ink-muted">
        {formatMoney(item.unitCost)}
      </span>
      <span
        className={cn(
          "bw-num w-28 shrink-0 text-right text-[0.75rem] font-semibold",
          belowFloor ? "text-negative" : "text-ink",
        )}
        title={
          floor !== null
            ? `Category floor ${formatMargin(floor)}`
            : `No margin floor on file for ${item.category} — this margin has not been checked`
        }
      >
        {formatMargin(margin)}
        {floor !== null ? (
          <span className="ml-1 font-medium text-ink-muted">
            {margin >= floor ? "+" : "−"}
            {formatMargin(Math.abs(margin - floor)).replace("%", "")}pt
          </span>
        ) : (
          // No floor on file. Say so on the row rather than printing a bare
          // margin, which reads as "checked, and fine".
          <span className="ml-1 font-medium text-ink-muted">· no floor</span>
        )}
      </span>
      <span className="bw-num w-20 shrink-0 text-right text-[0.72rem] text-ink-muted">
        {item.inventory.toLocaleString("en-US")}
      </span>
      <span className="bw-num w-16 shrink-0 text-right text-[0.72rem] text-ink-muted">
        {cover === null ? "—" : `${cover}w`}
      </span>
      {item.status !== "live" ? (
        <Pill tone="neutral">{item.status}</Pill>
      ) : null}
    </li>
  );
}

export function CatalogPage() {
  const { data } = useCommerceLedger();
  const [category, setCategory] = useState<string>("all");

  const visible = useMemo(() => {
    const rows = data.products.filter(
      (p) => category === "all" || p.category === category,
    );
    return [...rows].sort((a, b) => {
      const aOut = FLOOR_WORKLIST_RANK[productFloorStatus(data.floors, a)];
      const bOut = FLOOR_WORKLIST_RANK[productFloorStatus(data.floors, b)];
      if (aOut !== bOut) return aOut - bOut;
      return productMargin(a) - productMargin(b);
    });
  }, [data.products, data.floors, category]);

  const tally = tallyFloorStatus(data.floors, data.products);
  const belowFloorTotal = belowFloorCount(data.floors, data.products);
  const floorCaveat = noFloorCaveat(tally.unknown);
  const medianMargin = useMemo(() => {
    const margins = data.products.map(productMargin).sort((a, b) => a - b);
    if (!margins.length) return null;
    const mid = Math.floor(margins.length / 2);
    return margins.length % 2 === 0
      ? (margins[mid - 1] + margins[mid]) / 2
      : margins[mid];
  }, [data.products]);
  const stockAtCost = data.products.reduce(
    (sum, p) => sum + p.inventory * p.unitCost,
    0,
  );

  const floorOf = (item: Product) =>
    data.floors.find((f) => f.category === item.category)?.floor ?? null;

  // ── BEAT 3b ──────────────────────────────────────────────────────────────
  // What is VISIBLY on this page — the active category filter, the rows
  // actually rendered in the order shown, and the plans on file. Not the whole
  // ledger: the global readable in tools.tsx already carries that, and the point
  // of this one is that the agent can describe what the user can literally see.
  useAgentContext({
    description:
      "The Catalog page the user is currently viewing: the active category " +
      "filter, the product rows actually visible on screen in the order shown " +
      "with their margin against the category floor, and the restock plans on " +
      "file. `book` holds whole-range figures that the category filter does NOT " +
      "narrow — never report those as the contents of this view. " +
      "`book.belowFloorCount` is null when any SKU has no category floor on " +
      "file (`book.skusWithNoFloorOnFile`): the range could not be fully " +
      "checked, so do NOT read that null as zero or as an all-clear.",
    value: JSON.stringify({
      page: "catalog",
      filters: { category },
      visibleCount: visible.length,
      // WHOLE-RANGE, and therefore nested. These three are computed over
      // `data.products` regardless of the category filter, and they used to sit
      // flat beside `filters` and `visibleCount` — the exact shape `orders.tsx`
      // documents as removed, where an agent reports a book-wide total as the
      // contents of a filtered view. `belowFloorCount` stays `null` when any SKU
      // could not be checked, with the companion count so the null cannot be read
      // as "none".
      book: {
        belowFloorCount: belowFloorTotal,
        skusWithNoFloorOnFile: tally.unknown,
        medianMargin: medianMargin === null ? null : formatMargin(medianMargin),
      },
      rows: visible.slice(0, 25).map((p) => ({
        sku: p.sku,
        name: p.name,
        category: p.category,
        listPrice: p.listPrice,
        unitCost: p.unitCost,
        margin: formatMargin(productMargin(p)),
        floor: floorOf(p) === null ? null : formatMargin(floorOf(p) as number),
        // `null`, never `false`, when the category has no floor: "not checked"
        // and "checked and fine" are different claims.
        belowFloor: nullableBelowFloor(productFloorStatus(data.floors, p)),
        inventory: p.inventory,
        weeksOfCover: weeksOfCover(p),
      })),
      plans: data.plans.map((plan) => ({
        id: plan.id,
        vendor: plan.vendor,
        season: plan.season,
        skus: plan.lines.map((l) => l.sku),
      })),
    }),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Catalog"
        subtitle="Every SKU against its category margin floor, worst first."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="SKUs" value={String(data.products.length)} />
        {/* An em dash, never a green zero, when the range could not be fully
            checked: this tile is the page's all-clear and it may only show one
            when there is one. */}
        <Metric
          label="Below floor"
          value={belowFloorTotal === null ? "—" : String(belowFloorTotal)}
          hint={floorCaveat ?? undefined}
          tone={
            belowFloorTotal === null || belowFloorTotal > 0
              ? "negative"
              : "positive"
          }
        />
        <Metric
          label="Median margin"
          value={medianMargin === null ? "—" : formatMargin(medianMargin)}
          tone="brand"
        />
        <Metric label="Stock at cost" value={formatMoney(stockAtCost)} />
      </div>

      <Panel className="mb-5">
        <SectionLabel>Margin ladder</SectionLabel>
        <MarginLadder floors={data.floors} products={data.products} />
      </Panel>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[0.7rem] font-medium text-ink-muted">
          Category
        </span>
        {(["all", ...CATEGORY_ORDER] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setCategory(candidate)}
            className={activeSelectClass(category === candidate)}
          >
            {candidate === "all" ? "All" : candidate}
          </button>
        ))}
      </div>

      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          <span className="h-8 w-8 shrink-0" />
          <span className="min-w-0 flex-1">Product</span>
          <span className="w-16 shrink-0 text-right">List</span>
          <span className="w-16 shrink-0 text-right">Cost</span>
          <span className="w-28 shrink-0 text-right">Margin vs floor</span>
          <span className="w-20 shrink-0 text-right">On hand</span>
          <span className="w-16 shrink-0 text-right">Cover</span>
        </div>
        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No products in this category"
              hint="Switch back to All to see the whole range."
              icon={<PackageSearch className="h-5 w-5" />}
            />
          </div>
        ) : (
          <ul>
            {visible.map((item) => (
              <ProductRow
                key={item.id}
                item={item}
                status={productFloorStatus(data.floors, item)}
                floor={floorOf(item)}
              />
            ))}
          </ul>
        )}
      </Panel>

      {/* BEAT 3d — the durable artifact surface. */}
      <div className="mt-6">
        <SectionLabel>Restock plans</SectionLabel>
        {data.plans.length === 0 ? (
          <Panel>
            <EmptyState
              title="No plans on file"
              hint="Attach a vendor price sheet in the chat and ask Bellwether to file the restock plan — it lands here, in the app."
              icon={<FileText className="h-5 w-5" />}
            />
          </Panel>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.plans.map((plan) => (
              <Panel key={plan.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {plan.season}
                    </p>
                    <p className="truncate text-[0.72rem] text-ink-muted">
                      {plan.vendor} · filed by {plan.filedBy}
                    </p>
                  </div>
                  <Pill tone="brand">{plan.lines.length} SKUs</Pill>
                </div>

                <p className="mt-2.5 text-[0.78rem] leading-relaxed text-ink">
                  {plan.summary}
                </p>

                {plan.highlights.length > 0 ? (
                  <ul className="mt-2.5 space-y-1">
                    {keyedList(plan.highlights, (h) => h).map(
                      ({ key, item: highlight }) => (
                        <li
                          key={key}
                          className="flex gap-1.5 text-[0.72rem] text-ink-muted"
                        >
                          <span className="text-brand">•</span>
                          {highlight}
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}

                {plan.lines.length > 0 ? (
                  <ul className="mt-3 divide-y divide-hairline border-t border-hairline pt-1">
                    {keyedList(plan.lines, (l) => l.sku || l.name).map(
                      ({ key, item: line }) => (
                        <li
                          key={key}
                          className="flex items-center gap-2 py-1.5"
                        >
                          <SkuTile name={line.name || line.sku} size="xs" />
                          <span className="min-w-0 flex-1 truncate text-[0.74rem] text-ink">
                            {line.name || line.sku}
                          </span>
                          <span className="bw-num shrink-0 text-[0.72rem] font-medium text-ink">
                            {formatMoney(line.landedCost)}
                          </span>
                          <span className="bw-num shrink-0 text-[0.68rem] text-ink-muted">
                            ×{line.units.toLocaleString("en-US")}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}

                {plan.schedule.length > 0 ? (
                  <ol className="mt-3 space-y-1 border-l-2 border-brand/25 pl-3">
                    {keyedList(plan.schedule, (s) => `${s.week} ${s.item}`).map(
                      ({ key, item: step }) => (
                        <li key={key} className="text-[0.72rem] text-ink">
                          <span className="bw-num mr-1.5 font-medium text-ink-muted">
                            {step.week}
                          </span>
                          {step.item}
                        </li>
                      ),
                    )}
                  </ol>
                ) : null}
              </Panel>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
