"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LADDER_FLOOR_RATIO,
  formatMargin,
  formatMoney,
  ladderRatio,
  marginAt,
  tallyFloorStatus,
} from "../data/derive";
import type { FloorTally } from "../data/derive";
import type { Category, MarginFloor, Product } from "../data/types";
import { SkuTile } from "./sku-tile";

/**
 * THE MARGIN LADDER — Bellwether's signature element.
 *
 * One vertical rail per category, each anchored to its OWN margin floor: the
 * floor line sits at the same height on every rail regardless of whether that
 * category's floor is 38% or 55%. That anchoring is the whole idea. A
 * conventional margin chart plots gross margin on a shared axis, which makes
 * Accessories tower over Home and tells a merchandiser nothing they did not
 * already know. Anchoring to the floor puts every product on the same "distance
 * from the line I am not allowed to cross" scale, so "the Harbor Parka is under
 * its floor" and "the Lark Runner is under its floor" line up at the same height
 * and become comparable at a glance — which is exactly the question a
 * merchandiser is actually asking, and exactly the shape of the preference
 * beat 4 recalls.
 *
 * Anything below its floor is drawn BELOW the floor line, in the negative
 * colour, with its name always visible. Those are the actionable SKUs, so they
 * are the only ones that get a label without being hovered. Every one of those
 * labels tracks its own dot — see `placeLabels`, which owns that guarantee.
 *
 * The geometry that makes the anchoring true lives in `derive.ladderRatio` /
 * `derive.LADDER_FLOOR_RATIO` — a floor-relative axis shared by every rail. Read
 * the comment there before changing any position in here.
 */

export interface LadderProduct {
  id: string;
  sku: string;
  name: string;
  category: Category;
  listPrice: number;
  unitCost: number;
}

export interface PlacedDot {
  item: LadderProduct;
  /** Pixels above the rail's base. */
  y: number;
  /**
   * Horizontal nudge applied when dots would overlap, as a FRACTION OF THE
   * COLUMN'S WIDTH — not pixels. Never read it raw: pass it to `fanLeft()`,
   * which is the only place the unit is turned into CSS, so a dot and anything
   * that has to track a dot (its below-floor label) cannot drift apart.
   */
  xFraction: number;
  margin: number;
  belowFloor: boolean;
}

/**
 * A collision run the fan cannot visually separate at the width this ladder may
 * actually be drawn at. Rendered as a count badge, because the alternative —
 * overlapping dots and no number — is a reader silently undercounting the very
 * thing the ladder exists to let them count.
 */
interface DotCluster {
  /** The run's first dot id; stable enough to key the badge on. */
  id: string;
  /** Pixels above the rail's base, at the middle of the run. */
  y: number;
  size: number;
}

const COLLISION_PX = 19;

/**
 * THE COLLISION FAN — the ladder's HORIZONTAL geometry. (The vertical mapping is
 * `derive.ladderRatio` and is a separate, load-bearing thing; do not mix them.)
 *
 * Every offset here is a FRACTION OF THE COLUMN WIDTH, because a column has no
 * fixed width: `flex-1 min-w-0` over five categories gives ~75px inside the chat
 * transcript and 3x that on the catalog page, and the ladder is drawn in both.
 * This replaced a fixed px table (`[0, 15, -15, 30, -30, 45, -45]` indexed
 * `idx % 7`), which failed twice over:
 *  - the 8th dot in a run was handed the 1st dot's slot, so past seven
 *    co-located SKUs dots overlapped EXACTLY and the reader undercounted;
 *  - ±45px on a ~75px column is outside that column, and nothing here clips
 *    overflow, so a dot could be drawn over the NEIGHBOURING category's rail and
 *    read as belonging to a category it is not in — a wrong reading, not a
 *    cosmetic one.
 * Both are fixed by scaling to the run's size AND to the column: the fan widens
 * only as far as the run needs, and never past `FAN_MAX_FRACTION` of the column.
 */

/**
 * The widest a fanned dot may sit from its rail, as a fraction of the column.
 * Strictly under 0.5 (the half-width at which a dot reaches the next column),
 * with room left for the dot's own radius.
 */
export const FAN_MAX_FRACTION = 0.36;
/** Gap between neighbouring dots in a run small enough to get its way. */
const FAN_STEP_FRACTION = 0.09;
/**
 * The narrowest column the ladder is realistically drawn in: five categories
 * inside a compact chat card, plus the compact dot's diameter. Together they
 * give the number of dots a saturated fan can still separate BY EYE at that
 * width — past that, the badge carries the count instead of the dots.
 */
const NARROWEST_COLUMN_PX = 64;
const COMPACT_DOT_PX = 10;
export const FAN_LEGIBLE_MAX =
  Math.floor((2 * FAN_MAX_FRACTION * NARROWEST_COLUMN_PX) / COMPACT_DOT_PX) + 1;

/**
 * Horizontal offsets for `count` colliding dots, as fractions of the column
 * width, in the run's own (y-ascending) order — so the fan reads left-to-right
 * in the order the dots climb the rail.
 *
 * Guarantees, both of them asserted in this component's test:
 *  - every offset is DISTINCT, at every count (no fixed table, no modulo);
 *  - `|offset| <= FAN_MAX_FRACTION`, so no dot can reach a neighbouring rail.
 */
export function fanOffsets(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const amplitude = Math.min(
    FAN_MAX_FRACTION,
    (FAN_STEP_FRACTION * (count - 1)) / 2,
  );
  // `amplitude * (2i/(n-1) - 1)` rather than `-amplitude + i * step`: the former
  // lands on exactly ±amplitude at the ends, so the bound holds without a float
  // epsilon creeping over it.
  return Array.from(
    { length: count },
    (_, i) => amplitude * ((2 * i) / (count - 1) - 1),
  );
}

/**
 * The CSS `left` for something sitting at fan offset `xFraction`. The one place
 * the fraction becomes CSS: a percentage on `left` resolves against the COLUMN's
 * width (unlike a percentage in `translate`, which resolves against the element's
 * own size), which is what makes a width-relative fan expressible without
 * measuring anything.
 */
export function fanLeft(xFraction: number): string {
  const pct = Number((xFraction * 100).toFixed(3));
  // The sign goes in the OPERATOR, never in the operand: `calc(50% + -12%)` is
  // rejected by enough parsers to be worth avoiding, and a rejected `left` is a
  // dot back on the rail's centre with nothing to show it moved.
  return `calc(50% ${pct < 0 ? "-" : "+"} ${Math.abs(pct)}%)`;
}

/** Text starts this far from its dot's centre, clear of the dot itself. */
const LABEL_GAP_PX = 10;
/**
 * One label owns a horizontal band this tall and no two labels may share one.
 * Sized to the label's line box (0.65rem text), so separating two labels by this
 * much is what makes them unable to overlap whatever their text turns out to be
 * — a width this component cannot know at layout time.
 */
export const LABEL_ROW_PX = 14;
/** Drops the text's line box onto its dot's centre. */
const LABEL_DROP_PX = 6;

function place(
  items: LadderProduct[],
  floor: MarginFloor,
  railHeight: number,
): { dots: PlacedDot[]; clusters: DotCluster[] } {
  const dots = items
    .map((item) => {
      const margin = marginAt(item.listPrice, item.unitCost);
      return {
        item,
        y: ladderRatio(margin, floor.floor) * railHeight,
        xFraction: 0,
        margin,
        belowFloor: margin < floor.floor,
      } satisfies PlacedDot;
    })
    .sort((a, b) => a.y - b.y);

  // Fan out anything that would land on top of its neighbour.
  const clusters: DotCluster[] = [];
  let runStart = 0;
  for (let i = 1; i <= dots.length; i += 1) {
    const breaks =
      i === dots.length || dots[i].y - dots[i - 1].y >= COLLISION_PX;
    if (!breaks) continue;
    const run = dots.slice(runStart, i);
    if (run.length > 1) {
      const offsets = fanOffsets(run.length);
      run.forEach((dot, idx) => {
        dot.xFraction = offsets[idx];
      });
      if (run.length > FAN_LEGIBLE_MAX) {
        clusters.push({
          id: run[0].item.id,
          y: (run[0].y + run[run.length - 1].y) / 2,
          size: run.length,
        });
      }
    }
    runStart = i;
  }
  return { dots, clusters };
}

export interface PlacedLabel {
  item: LadderProduct;
  /**
   * The fan offset of the dot this label names — IDENTICAL to `dot.xFraction`,
   * which is the entire point of this type. A FRACTION of the column's width, not
   * pixels: pass it to `fanLeft()` exactly as the dot does, so the label and the
   * dot cannot be positioned by two different units.
   */
  xFraction: number;
  /** Pixels above the rail's base. */
  y: number;
  /** Which way the text runs from its dot. */
  side: "left" | "right";
}

/**
 * WHERE A BELOW-FLOOR NAME GOES — pure, because a label that names the wrong dot
 * is worse than no label, and "which dot does this word belong to" is not
 * something a rendered pixel can be asked afterwards.
 *
 * Two rules, and they exist because the labels were previously drawn at a FIXED
 * `left-1/2 translate-x-4` while their dots were fanned horizontally by up to
 * ±45px:
 *
 *  - `x` is copied from the dot, never chosen. A label whose dot was fanned and
 *    which did not move with it points at empty rail — and at a NEIGHBOUR's dot
 *    if that neighbour happens to sit where the label ended up.
 *  - two labels on one rail may not share a horizontal band. A fanned cluster is
 *    by definition within `COLLISION_PX` vertically, so the dots separate
 *    sideways but their labels — text of unknown width running from each dot —
 *    would still collide. Text needs its own ROW, so each label is pushed up to
 *    the first free one. Under a `LADDER_FLOOR_RATIO` band ~46px tall on a full
 *    rail that is three violations before a label rises past the floor line,
 *    which is still inside the rail and still unambiguous, because it kept its
 *    dot's `x`.
 *
 * `side` is the same idea applied outward: a dot fanned RIGHT runs its text back
 * to the left, so a label never leaves the column its rail owns just because its
 * dot sits near the edge.
 */
export function placeLabels(dots: PlacedDot[]): PlacedLabel[] {
  const labels: PlacedLabel[] = [];
  const ordered = dots.filter((d) => d.belowFloor).sort((a, b) => a.y - b.y);
  for (const dot of ordered) {
    const previous = labels[labels.length - 1];
    const wanted = dot.y - LABEL_DROP_PX;
    labels.push({
      item: dot.item,
      xFraction: dot.xFraction,
      y: previous ? Math.max(wanted, previous.y + LABEL_ROW_PX) : wanted,
      side: dot.xFraction > 0 ? "left" : "right",
    });
  }
  return labels;
}

/**
 * The label's own transform — the GAP and the side flip only.
 *
 * The fan offset itself is NOT in here: it goes through `fanLeft(label.xFraction)`
 * on the `left` property, exactly as the dot's does, because the offset is a
 * fraction of the column's width and this transform is in pixels. Putting a
 * fraction through a `px` interpolation is precisely the mismatch the rename from
 * `x` to `xFraction` exists to make impossible — a label would have sat ~0.3px
 * from centre while its dot sat 30% away.
 *
 * It stays a transform rather than a Tailwind translate utility for the same
 * reason the dot's does: a utility class would be OVERWRITTEN by an inline
 * `transform`, not composed with it. `-100%` is what makes a left-running label
 * END at its dot instead of starting there.
 */
export function labelTransform(label: PlacedLabel): string {
  return label.side === "right"
    ? `translateX(${LABEL_GAP_PX}px)`
    : `translateX(calc(-100% - ${LABEL_GAP_PX}px))`;
}

/**
 * THE LADDER'S ONE-LINE SUMMARY — pure, so every state is testable and no branch
 * can be added without deciding what an EMPTY range says.
 *
 * The rule this encodes: an all-clear may only be printed when something was
 * actually checked. `below === 0` does not earn one on its own, because that is
 * also what an empty range yields — and "no product is below its floor" out of
 * zero products examined is the most reassuring sentence this component could
 * print and the least true. So the first question is how many products were
 * measured against a floor at all (`below + clear`), not how many failed.
 *
 * An empty range is reachable, not theoretical. `showMarginLadder` filters
 * `products` by a MODEL-supplied category string while falling back to the full
 * `floors` list, so any category the model invents or misspells draws every rail
 * and no dots; and `ledger-context` mounts children with `products: []` on a
 * failed first fetch, which is the demo-day shape.
 *
 * Rails come from `floors`, so `unknown` — a product whose category has no floor
 * on file — is exactly the set that is on NO rail: silently absent rather than
 * visibly fine. It is reported separately in every branch for that reason.
 */
export function ladderCaption(tally: FloorTally): string {
  const { below, clear, unknown } = tally;
  const checked = below + clear;
  const products = (n: number) => (n === 1 ? "product" : "products");
  const have = (n: number) => (n === 1 ? "has" : "have");
  const are = (n: number) => (n === 1 ? "is" : "are");

  // Nothing was measured against anything: say so, and say why.
  if (checked === 0) {
    return unknown === 0
      ? "No products in this range — nothing has been checked against a floor."
      : `Nothing is plotted: all ${unknown} ${products(unknown)} in this range ${have(unknown)} no category floor on file, so ${unknown === 1 ? "it was" : "they were"} not checked against one.`;
  }

  if (below === 0) {
    return unknown === 0
      ? "Every product is trading above its category floor."
      : `No plotted product is below its floor, but ${unknown} ${products(unknown)} ${have(unknown)} no category floor on file and ${are(unknown)} not on any rail.`;
  }

  const headline = `${below} ${products(below)} ${are(below)} below their category floor — shown in red, under the floor line.`;
  return unknown === 0
    ? headline
    : `${headline} ${unknown} more ${have(unknown)} no floor on file and ${are(unknown)} not plotted.`;
}

export function MarginLadder({
  floors,
  products,
  compact = false,
  highlightIds,
  className,
}: {
  floors: MarginFloor[];
  products: Product[];
  /** Narrow variant for the chat transcript. */
  compact?: boolean;
  /** Draw a markdown ring on these SKUs — the ones a tool just touched. */
  highlightIds?: string[];
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const railHeight = compact ? 160 : 232;
  const highlighted = useMemo(
    () => new Set(highlightIds ?? []),
    [highlightIds],
  );

  const columns = useMemo(
    () =>
      floors.map((floor) => {
        const { dots, clusters } = place(
          products
            .filter((p) => p.category === floor.category)
            .map((p) => ({
              id: p.id,
              sku: p.sku,
              name: p.name,
              category: p.category,
              listPrice: p.listPrice,
              unitCost: p.unitCost,
            })),
          floor,
          railHeight,
        );
        // Labels are derived HERE, from the very dots that will be drawn, rather
        // than positioned independently at render time — the two cannot drift.
        // `clusters` rides along from `place`: it carries the ×N badge for a run
        // too long to fan legibly, which is the other half of not lying about
        // what is on the rail.
        return { floor, dots, clusters, labels: placeLabels(dots) };
      }),
    [floors, products, railHeight],
  );

  // ONE tally behind the caption — plotted, below-floor and no-floor-on-file can
  // therefore never disagree with each other. It also replaced a `columns`-derived
  // below-floor count: that count could only ever be a number, and a number is
  // what let the caption treat "zero violations" and "zero products" as the same
  // state. `ladderCaption` owns that distinction; see its comment.
  const tally = useMemo(
    () => tallyFloorStatus(floors, products),
    [floors, products],
  );
  const caption = ladderCaption(tally);

  // ONE height for every floor line, computed OUTSIDE the column loop so no
  // future edit can quietly make it a function of the category again. That is
  // the invariant this whole component is built on.
  const floorY = LADDER_FLOOR_RATIO * railHeight;

  return (
    <figure className={cn("w-full", className)}>
      <div
        className="flex items-end gap-1"
        // Rail + the mt-4 gutter under it + the caption block (two lines
        // compact, three once the floor percentage is shown).
        style={{ height: railHeight + (compact ? 50 : 70) }}
      >
        {columns.map(({ floor, dots, clusters, labels }) => {
          // The target DOES move per category — it is real data (9 to 12 points
          // over the floor), not the shared anchor.
          const targetY = ladderRatio(floor.target, floor.floor) * railHeight;
          return (
            <div
              key={floor.category}
              className="flex min-w-0 flex-1 flex-col items-center"
            >
              <div className="relative w-full" style={{ height: railHeight }}>
                {/* The rail. `.bw-rail` carries the ink gradient so it tracks
                    the live theme tokens rather than a hard-coded colour. */}
                <div
                  className="bw-rail absolute left-1/2 top-0 h-full w-2.5 -translate-x-1/2 rounded-full"
                  aria-hidden
                />
                {/* The margin floor — the line the gate is enforced against, and
                    the one place a rail earns a warning colour. Drawn wider than
                    the rail so it reads as a threshold across the column rather
                    than as a segment of the rail itself. Its width is capped as a
                    SHARE of the column for the same reason the dot fan is: a flat
                    2.25rem is wider than the column once five categories share a
                    compact chat card, and nothing here clips overflow, so it
                    would read as the neighbouring category's floor. */}
                <div
                  className="bw-rail-floor absolute left-1/2 h-[2px] w-[min(2.25rem,86%)] -translate-x-1/2 rounded-full"
                  style={{ bottom: floorY }}
                  aria-hidden
                />
                {/* The planned margin. Quiet — a reference, not an alarm. */}
                <div
                  className="bw-rail-target absolute left-1/2 h-[2px] w-[min(1.5rem,58%)] -translate-x-1/2 rounded-full"
                  style={{ bottom: targetY }}
                  aria-hidden
                />

                {dots.map((dot) => {
                  const isHovered = hovered === dot.item.id;
                  return (
                    <button
                      key={dot.item.id}
                      type="button"
                      onMouseEnter={() => setHovered(dot.item.id)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(dot.item.id)}
                      onBlur={() => setHovered(null)}
                      aria-label={`${dot.item.name}, ${dot.item.category}, ${formatMargin(
                        dot.margin,
                      )} margin${dot.belowFloor ? ", below floor" : ""}`}
                      className="absolute rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      style={{
                        // The fan rides on `left`, where its percentage resolves
                        // against the COLUMN's width; `transform` then only
                        // centres the dot on that point. Keep the centring
                        // INLINE — a Tailwind `-translate-x-1/2` would be
                        // overwritten by this style rather than composed with it,
                        // which silently shifts every dot half its width off the
                        // rail.
                        left: fanLeft(dot.xFraction),
                        bottom: dot.y,
                        transform: "translate(-50%, 50%)",
                        zIndex: isHovered ? 30 : dot.belowFloor ? 20 : 10,
                      }}
                    >
                      <span
                        className={cn(
                          "block rounded-full border-2 transition-transform",
                          compact ? "h-2.5 w-2.5" : "h-3 w-3",
                          // Full-strength ink with a surface-coloured border: at
                          // reduced opacity these disappeared into their own
                          // rail, which is the one thing a dot on a rail must
                          // not do.
                          dot.belowFloor
                            ? "bw-flag border-surface bg-negative"
                            : highlighted.has(dot.item.id)
                              ? "border-brand-violet bg-brand"
                              : "border-surface bg-brand",
                          isHovered && "scale-150",
                        )}
                      />
                    </button>
                  );
                })}

                {/* A pile-up denser than the fan can separate at this width does
                    NOT get to pass as a handful of dots: the badge states how
                    many SKUs are in it, so nobody counts blobs and undercounts.
                    `pointer-events-none` keeps every dot underneath hoverable,
                    and each dot is still its own labelled button, so the badge is
                    a visual aid only — hence `aria-hidden`. */}
                {clusters.map((cluster) => (
                  <span
                    key={`${cluster.id}-cluster`}
                    className="bw-num pointer-events-none absolute left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full border border-hairline bg-surface px-1 text-[0.6rem] font-semibold leading-tight text-ink"
                    style={{ bottom: cluster.y, zIndex: 25 }}
                    aria-hidden
                  >
                    ×{cluster.size}
                  </span>
                ))}

                {/* Below-floor names are always visible: they are the rows
                    anyone is actually here to act on. Everything else labels on
                    hover. Geometry comes from `placeLabels` — read its comment
                    before moving one, and note that `data-fan-x` is the dot
                    offset this label is REQUIRED to share with its dot. */}
                {!compact &&
                  labels.map((label) => (
                    <span
                      key={`${label.item.id}-label`}
                      data-fan-x={label.xFraction}
                      className="bw-num pointer-events-none absolute whitespace-nowrap text-[0.65rem] font-semibold text-negative"
                      style={{
                        // Same `fanLeft` the dot uses, off the same fraction, so
                        // the label cannot be positioned in a different unit from
                        // the thing it names. `left-1/2` is gone from the class
                        // list because `fanLeft` already includes the 50% centre.
                        left: fanLeft(label.xFraction),
                        bottom: label.y,
                        transform: labelTransform(label),
                      }}
                    >
                      {label.item.name.split(" ")[0]}
                    </span>
                  ))}
              </div>

              <div className="mt-4 text-center">
                <div className="text-[0.72rem] font-semibold text-ink">
                  {floor.category}
                </div>
                <div className="bw-num text-[0.62rem] text-ink-muted">
                  {dots.length} {dots.length === 1 ? "SKU" : "SKUs"}
                </div>
                {!compact ? (
                  <div className="bw-num mt-0.5 text-[0.6rem] text-negative">
                    floor {formatMargin(floor.floor)}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hover detail. A fixed slot rather than a floating tooltip, so the
          ladder never reflows and never clips inside the chat column. */}
      <div className="mt-3 flex min-h-[2.25rem] items-center justify-between gap-3 rounded-md border border-hairline bg-surface-muted px-3 py-1.5">
        {hovered ? (
          (() => {
            const dot = columns
              .flatMap((c) => c.dots)
              .find((d) => d.item.id === hovered);
            if (!dot) return null;
            return (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  <SkuTile name={dot.item.name} size="xs" />
                  <span className="truncate text-[0.75rem] font-medium text-ink">
                    {dot.item.name}
                  </span>
                  <span className="bw-num hidden truncate text-[0.7rem] text-ink-muted sm:inline">
                    {dot.item.sku}
                  </span>
                </span>
                <span className="bw-num shrink-0 text-[0.72rem] font-semibold text-ink">
                  {formatMoney(dot.item.listPrice)}
                  <span
                    className={cn(
                      "ml-2 font-medium",
                      dot.belowFloor ? "text-negative" : "text-ink-muted",
                    )}
                  >
                    {formatMargin(dot.margin)}
                    {dot.belowFloor ? " · below floor" : " margin"}
                  </span>
                </span>
              </>
            );
          })()
        ) : (
          <span className="text-[0.72rem] text-ink-muted">{caption}</span>
        )}
      </div>
      <figcaption className="sr-only">
        Margin ladder. Each category is a rail anchored to its own margin floor;
        each dot is one product at its gross margin.
      </figcaption>
    </figure>
  );
}
