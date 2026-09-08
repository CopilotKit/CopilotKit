/**
 * BEAT 3c — the Register's four levers, in ONE normalized record.
 *
 * Everything downstream reads this module rather than the raw args: the confirm
 * card's chips, the pushed URL, the page's filter pipeline, and the tool
 * schema's advertised values. Three failures this exists to make impossible, all
 * three of which shipped in another skin first:
 *
 *  - **A lever value the view will not honour.** Every value the schema
 *    advertises must have a control on the page and must actually filter. The
 *    enums here ARE the page's control vocabularies, and `SPACE_FILTERS` is
 *    `satisfies readonly KnowledgeSpace[]`, so a space the corpus does not have
 *    is a BUILD error rather than a lever the card draws and the view ignores.
 *  - **A chip for a lever nobody set.** Arguments STREAM, so the confirm card
 *    renders while `args` is still half-empty. A `?? "all"` default therefore
 *    asserts a choice the agent never made — and can then flip when the real
 *    value arrives. An unset lever is `null` here and gets NO chip.
 *  - **A lever the model set only because the schema let it.** The lever
 *    parameters must NOT be `.optional()`: a model facing an optional enum fills
 *    it anyway, because omission is not a choice it can state. So the tool
 *    advertises `ANY_LEVER` / `0` as first-class members and the parameters are
 *    REQUIRED. Nothing downstream needs to know — the sentinels are not in the
 *    page's control vocabularies, so `normalizeRegisterLevers` drops them to
 *    `null` by construction: no chip, no query param, no extra branch.
 *
 * WHY `status` IS NOT A LEVER. Only one of the nine corpus documents is
 * plausibly a draft, so a `status` lever would advertise a value that leaves a
 * SINGLE row on stage — indistinguishable from a broken filter. `space` is 3/3/3
 * across the corpus and `attention` leaves 3/3/2, so every value of every lever
 * leaves several rows. Status is rendered as a column instead. If the corpus
 * ever grows, promoting status to a fifth lever is a one-line addition here.
 *
 * Server-safe on purpose: no React, no JSX, no `"use client"`.
 */

import type { KnowledgeSpace } from "@/skins/keel/knowledge/types";
import {
  ATTENTION_CLASSES,
  COVERAGE_WORKLIST_RANK,
  attentionClasses,
  coverageRatio,
  coverageStatus,
} from "./attention";
import type { AttentionClass } from "./attention";
import type { DocumentRecord } from "./types";

/**
 * DERIVED from the real union, not hand-copied — `satisfies` is what makes a
 * space the corpus cannot serve a build error.
 */
export const SPACE_FILTERS = [
  "privacy",
  "clinical",
  "vendor",
] as const satisfies readonly KnowledgeSpace[];

export const ATTENTION_FILTERS =
  ATTENTION_CLASSES satisfies readonly AttentionClass[];

export const REGISTER_SORTS = [
  "review_due_asc",
  "coverage_asc",
  "reviewed_desc",
  "ref_asc",
] as const;

/**
 * The value a lever takes when it is NOT being pulled.
 *
 * Measured rather than assumed, in logistics: told in as many words "do not
 * filter anything, just limit it to the top 3 rows", gpt-5.4 still returned two
 * filters that no row satisfied, and the maneuver landed on an EMPTY board with
 * four confidently tinted controls. No prompt sentence fixed it, because the
 * model had no way to SAY "no filter". This sentinel is that way.
 */
export const ANY_LEVER = "all";

/** What the TOOL advertises: the page's vocabulary plus the "not pulled" value. */
export const SPACE_ARGUMENTS = [ANY_LEVER, ...SPACE_FILTERS] as const;
export const ATTENTION_ARGUMENTS = [ANY_LEVER, ...ATTENTION_FILTERS] as const;
export const SORT_ARGUMENTS = [ANY_LEVER, ...REGISTER_SORTS] as const;

export type SpaceFilter = (typeof SPACE_FILTERS)[number];
export type AttentionFilter = (typeof ATTENTION_FILTERS)[number];
export type RegisterSort = (typeof REGISTER_SORTS)[number];

/**
 * Labels are keyed by the tuple's OWN element type, so adding a lever value
 * without a human label is a type error — an unlabelled chip is a chip that
 * reads `undefined` on stage.
 */
export const SPACE_LABELS: Record<SpaceFilter, string> = {
  privacy: "Privacy",
  clinical: "Clinical",
  vendor: "Vendor",
};

export const ATTENTION_FILTER_LABELS: Record<AttentionFilter, string> = {
  review_overdue: "Past review date",
  attestation_short: "Attestation short",
  unendorsed_revision: "Revision awaiting endorsement",
};

export const REGISTER_SORT_LABELS: Record<RegisterSort, string> = {
  review_due_asc: "Most overdue first",
  coverage_asc: "Lowest attestation first",
  reviewed_desc: "Most recently reviewed first",
  ref_asc: "By document number",
};

export interface RegisterLevers {
  space: SpaceFilter | null;
  attention: AttentionFilter | null;
  sort: RegisterSort | null;
  top: number | null;
}

/**
 * A positive integer, or null. Refuses rather than coerces: a limit the page
 * would ignore must not be drawn as a limit on the confirm card. Zero is the
 * `top` lever's own "not pulled" value.
 *
 * `Math.max(1, Number(raw) || 0)` — the shape this replaces elsewhere — turns
 * `?top=0`, `?top=-3` and `?top=abc` into a ONE-ROW board, indistinguishable on
 * stage from a legitimately narrow filter result. An unusable value behaves as
 * if the lever were absent instead: full list, control untinted, no chip.
 */
export function parseTopLever(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw).trim();
  // Digits only: rejects "", " ", "ten", "-5", "2.5", "1e3", "+5", "10px".
  if (!/^[0-9]+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const oneOf = <T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | null =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;

export function normalizeRegisterLevers(
  input: Partial<Record<keyof RegisterLevers, unknown>>,
): RegisterLevers {
  return {
    space: oneOf(SPACE_FILTERS, input.space),
    attention: oneOf(ATTENTION_FILTERS, input.attention),
    sort: oneOf(REGISTER_SORTS, input.sort),
    top: parseTopLever(input.top as string | number | null | undefined),
  };
}

/**
 * One chip per lever that was ACTUALLY set, in the order the controls sit on the
 * page. An unset lever is absent, not defaulted — see this file's header.
 */
export function registerLeverChips(
  levers: RegisterLevers,
): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = [];
  if (levers.space)
    chips.push({ label: "Space", value: SPACE_LABELS[levers.space] });
  if (levers.attention)
    chips.push({
      label: "Attention",
      value: ATTENTION_FILTER_LABELS[levers.attention],
    });
  if (levers.sort)
    chips.push({ label: "Sort", value: REGISTER_SORT_LABELS[levers.sort] });
  if (levers.top !== null)
    chips.push({ label: "Top", value: `${levers.top} rows` });
  return chips;
}

/**
 * The query string for a lever set — built from the SAME record the chips are,
 * so the view the card opens is the view the card just promised. Re-reading the
 * raw args here is how a confirm card and its URL drift apart.
 */
export function registerLeverQuery(levers: RegisterLevers): string {
  const params = new URLSearchParams();
  if (levers.space) params.set("space", levers.space);
  if (levers.attention) params.set("attention", levers.attention);
  if (levers.sort) params.set("sort", levers.sort);
  if (levers.top !== null) params.set("top", String(levers.top));
  return params.toString();
}

export function readRegisterLevers(params: URLSearchParams): RegisterLevers {
  return normalizeRegisterLevers({
    space: params.get("space"),
    attention: params.get("attention"),
    sort: params.get("sort"),
    top: params.get("top"),
  });
}

/**
 * Two lengths from ONE pipeline, so a "Top 10 of 22"-style caption cannot lie.
 *
 * `matching` is the count AFTER the filters and BEFORE the truncation;
 * `visible` is what the board actually paints. A caption whose denominator is
 * `documents.length` reads "Top 5 of 9" against 3 matching rows — the single
 * number the room is asked to read as proof of the maneuver instead says the
 * filters did nothing. The rows, the caption and the readable all read this one
 * result.
 */
export interface RegisterView {
  rows: DocumentRecord[];
  matching: number;
  visible: number;
  total: number;
}

const byRef = (a: DocumentRecord, b: DocumentRecord) =>
  a.ref.localeCompare(b.ref);

/**
 * `now` is a parameter for the same reason it is one in `attention.ts`: the seed
 * anchors every date relative to build time, so a sort that read the clock
 * itself could not be tested deterministically.
 */
export function applyRegisterLevers(
  documents: DocumentRecord[],
  levers: RegisterLevers,
  now: number,
): RegisterView {
  let rows = documents;
  if (levers.space) rows = rows.filter((doc) => doc.space === levers.space);
  if (levers.attention) {
    const wanted = levers.attention;
    rows = rows.filter((doc) => attentionClasses(doc, now).includes(wanted));
  }

  // Sorted on a COPY — `documents` is the store's own array on the server and a
  // provider's memo on the client, and an in-place sort would silently reorder
  // every other consumer of the same reference.
  const sorted = [...rows];
  switch (levers.sort) {
    case "review_due_asc":
      sorted.sort(
        (a, b) => a.reviewDue.localeCompare(b.reviewDue) || byRef(a, b),
      );
      break;
    case "coverage_asc":
      sorted.sort((a, b) => {
        // Unknown has no ratio, so it cannot be compared as a number at all —
        // it is placed by rank instead, which is why the rank table exists.
        const rank =
          COVERAGE_WORKLIST_RANK[coverageStatus(a)] -
          COVERAGE_WORKLIST_RANK[coverageStatus(b)];
        if (rank !== 0) return rank;
        const ra = coverageRatio(a);
        const rb = coverageRatio(b);
        if (ra === null || rb === null) return byRef(a, b);
        return ra - rb || byRef(a, b);
      });
      break;
    case "reviewed_desc":
      sorted.sort(
        (a, b) => b.lastReviewed.localeCompare(a.lastReviewed) || byRef(a, b),
      );
      break;
    case "ref_asc":
      sorted.sort(byRef);
      break;
    default:
      break;
  }

  const matching = sorted.length;
  const visible = levers.top === null ? sorted : sorted.slice(0, levers.top);
  return {
    rows: visible,
    matching,
    visible: visible.length,
    total: documents.length,
  };
}
