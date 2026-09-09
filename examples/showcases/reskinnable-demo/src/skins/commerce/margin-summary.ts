import type { Category, MarginFloor, Product } from "./data/types";
import type { FloorStatus } from "./data/derive";
import {
  FLOOR_WORKLIST_RANK,
  productFloorStatus,
  productMargin,
  tallyFloorStatus,
} from "./data/derive";

/**
 * Row selection for BEAT 4's `showMarginSummary` list.
 *
 * Pure on purpose: the ordering and the truncation are the part of that
 * component worth testing, and they are testable here without a CopilotKit
 * provider, a ledger fetch or a DOM. `MarginSummaryList` in `./tools` renders
 * exactly what this returns, caption included.
 *
 * ── WHY THE CAPTION EXISTS ──────────────────────────────────────────────────
 *
 * The list is capped so a fourteen-SKU range does not push the rest of the
 * transcript off screen. The cap is fine; a SILENT cap is not. Bellwether's
 * whole claim is that margin is comparable across categories, and under
 * `byCategory` the ranked order is alphabetical by category — so the cap drops
 * TRAILING CATEGORIES rather than trailing rows. Against the seeded range
 * (14 SKUs, cap 12) `byCategory` without `belowFloorFirst` withholds both
 * Outerwear SKUs, one of which is below its floor. A reader cannot tell that
 * from a category that had nothing to report: the list reads as complete and
 * the missing violation reads as an all-clear.
 *
 * So every withheld row is accounted for in one sentence, which names three
 * things a reader would otherwise have to guess at:
 *
 *  1. how many rows were withheld, out of how many;
 *  2. how many of those were below floor or could not be checked at all;
 *  3. which categories vanished ENTIRELY, by name.
 *
 * A per-category quota was the alternative and was rejected: it would inject a
 * category's best row ahead of worse-margin rows from other categories, so the
 * list would stop being "the rows that most need attention, in order" — the
 * property the ranking below exists to give it.
 */
export const SUMMARY_ROW_CAP = 12;

/**
 * "Below floor first" ordering. A SKU whose category has no floor on file sorts
 * with the exceptions, not with the clean rows: it has not been cleared, it has
 * not been checked.
 *
 * An ALIAS of `derive.FLOOR_WORKLIST_RANK` rather than its own table — the
 * catalog's rows, the promotions desk's cards and this list all rank the same
 * three verdicts, and a private copy is exactly how one of them would later fold
 * `unknown` back in with `clear`.
 */
export const SUMMARY_RANK: Record<FloorStatus, number> = FLOOR_WORKLIST_RANK;

export interface SummaryRowSelection {
  /** The rows to render, in display order. */
  visible: Product[];
  /** How many ranked rows the cap withheld. */
  withheld: number;
  /** Categories with a withheld row and NO surviving row — gone entirely. */
  droppedCategories: Category[];
  /** The sentence the list owes the reader; `null` when nothing was withheld. */
  caption: string | null;
}

export interface SummaryRowOptions {
  byCategory: boolean;
  belowFloorFirst: boolean;
  /** Defaults to `SUMMARY_ROW_CAP`. */
  cap?: number;
}

/**
 * Rank the range the way the summary reads it, then cap it and account for
 * whatever the cap withheld.
 *
 * `belowFloorFirst` is what keeps violations above the cut — with it set, every
 * below-floor (and every unchecked) row sorts ahead of every clean one, so a
 * violation can only be withheld once the exceptions alone overflow the cap.
 * With it unset the caption is the only thing standing between a withheld
 * violation and a false all-clear, which is why the counts are computed from the
 * withheld rows themselves rather than from the cap arithmetic.
 */
export function selectSummaryRows(
  products: readonly Product[],
  floors: MarginFloor[],
  options: SummaryRowOptions,
): SummaryRowSelection {
  const { byCategory, belowFloorFirst, cap = SUMMARY_ROW_CAP } = options;

  const ranked = [...products].sort((a, b) => {
    if (belowFloorFirst) {
      const aOut = SUMMARY_RANK[productFloorStatus(floors, a)];
      const bOut = SUMMARY_RANK[productFloorStatus(floors, b)];
      if (aOut !== bOut) return aOut - bOut;
    }
    if (byCategory && a.category !== b.category)
      return a.category.localeCompare(b.category);
    return productMargin(a) - productMargin(b);
  });

  const visible = ranked.slice(0, Math.max(0, cap));
  const withheldRows = ranked.slice(visible.length);

  const shown = new Set(visible.map((item) => item.category));
  const droppedCategories: Category[] = [];
  for (const item of withheldRows) {
    if (shown.has(item.category) || droppedCategories.includes(item.category))
      continue;
    droppedCategories.push(item.category);
  }

  return {
    visible,
    withheld: withheldRows.length,
    droppedCategories,
    caption: describeWithheld(
      withheldRows,
      ranked.length,
      floors,
      droppedCategories,
    ),
  };
}

function describeWithheld(
  withheldRows: Product[],
  total: number,
  floors: MarginFloor[],
  droppedCategories: Category[],
): string | null {
  if (withheldRows.length === 0) return null;

  const tally = tallyFloorStatus(floors, withheldRows);
  const flags: string[] = [];
  if (tally.below > 0) flags.push(`${tally.below} below floor`);
  if (tally.unknown > 0) flags.push(`${tally.unknown} not checked`);

  const head =
    `${withheldRows.length} of ${total} SKUs not shown` +
    (flags.length > 0 ? ` (${flags.join(", ")})` : "") +
    ".";
  const tail =
    droppedCategories.length > 0
      ? ` Nothing from ${droppedCategories.join(", ")} appears here.`
      : "";

  return `${head}${tail}`;
}
