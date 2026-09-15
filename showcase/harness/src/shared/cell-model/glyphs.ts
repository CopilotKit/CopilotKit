/**
 * The dashboard's glyph vocabulary — ONE constant, switched on by BOTH the
 * renderer and the legend.
 *
 * Why this file exists
 * --------------------
 * The legend rotted because it was hand-written prose sitting next to
 * hand-written JSX in four different files, and the chip styling was a
 * hand-copied Tailwind string in four more. Two defects followed:
 *
 *   1. Three glyphs were EMOJI code points (`🚫` U+1F6AB, `⚡` U+26A1,
 *      `⏱` U+23F1). An Emoji-presentation code point is drawn from the colour
 *      emoji font, which IGNORES CSS colour entirely — so `🚫` painted RED on
 *      a grey chip whose glyph was explicitly `text-white`, and `⚡`'s indigo
 *      "pool unreachable" treatment never once applied (it painted yellow).
 *      `glyphs.test.ts` now bans the whole class mechanically.
 *   2. Absence and failure were the same SHAPE, so hue was the only cue —
 *      exactly the cue that fails at 16px, in greyscale, and under colour
 *      blindness.
 *
 * The encoding
 * ------------
 * ONE filled object per cell — the thing the cell reports (the depth chip in a
 * feature cell, the status chip in a starter cell). It goes HOLLOW when nothing
 * was judged. Everything else in a cell is a BARE MARK: prefix + coloured
 * glyph, no box, no fill, no border.
 *
 * `VERDICT` marks (`✓ ~ ✗`) are the only ones allowed green/amber/red.
 * `ABSENCE` marks (`∅ · ? — ! ⟳`) are slate, except the `!` fault marks which
 * are indigo — an infrastructure failure is not a verdict, so it never wears a
 * verdict colour. Colour-free backstop: hollow chips carry a border STYLE
 * (solid = settled fact, dashed = slot not filled in, dotted = expected but not
 * arrived) and bare absence marks carry a hairline DOTTED UNDERLINE.
 */

/** Stable identifier for each glyph in the vocabulary. */
export type GlyphId =
  | "pass"
  | "degraded"
  | "fail"
  | "notSupported"
  | "notShipped"
  | "noData"
  | "gated"
  | "fault"
  | "requeued";

/**
 * VERDICT — a probe ran and judged the cell. ABSENCE — nothing was judged, and
 * it must never read as a failure.
 */
export type GlyphClass = "verdict" | "absence";

/**
 * Palette role. Green/amber/red are VERDICT-ONLY; slate is the only absence
 * colour; indigo is the only fault colour. A mark can no longer sit in a tone
 * that contradicts its class.
 */
export type GlyphTone = "ok" | "amber" | "danger" | "slate" | "indigo";

/**
 * Colour-free second cut, carried by the hollow chip's border style:
 *   solid  = a settled fact
 *   dashed = a slot not filled in
 *   dotted = expected, hasn't arrived
 */
export type GlyphBorder = "solid" | "dashed" | "dotted";

export interface GlyphSpec {
  readonly id: GlyphId;
  /** The rendered mark. MUST be text-presentation — see `glyphs.test.ts`. */
  readonly mark: string;
  readonly glyphClass: GlyphClass;
  readonly tone: GlyphTone;
  /** Border style for the HOLLOW chip form. Verdict glyphs are filled. */
  readonly border: GlyphBorder;
  /** Short name used as the legend's bolded term. */
  readonly term: string;
  /** Legend copy. The legend renders exactly this, from exactly this table. */
  readonly legend: string;
}

/**
 * The vocabulary. Adding a glyph here adds a legend row automatically
 * (`AdaptiveLegend` maps over this table); emitting a mark that is NOT here
 * fails `glyphs.contract.test.tsx`.
 */
export const GLYPHS: Readonly<Record<GlyphId, GlyphSpec>> = {
  pass: {
    id: "pass",
    mark: "✓", // ✓ CHECK MARK — Emoji=No (unlike ✔ U+2714)
    glyphClass: "verdict",
    tone: "ok",
    border: "solid",
    term: "pass",
    legend: "the check succeeded on its last run",
  },
  degraded: {
    id: "degraded",
    mark: "~",
    glyphClass: "verdict",
    tone: "amber",
    border: "solid",
    term: "degraded",
    legend:
      "the check reported degradation, or its last green result is older than the freshness window",
  },
  fail: {
    id: "fail",
    mark: "✗", // ✗ BALLOT X — Emoji=No (unlike ✖ U+2716)
    glyphClass: "verdict",
    tone: "danger",
    border: "solid",
    term: "fail",
    legend: "the check ran and failed — this is the only thing ✗ means",
  },
  notSupported: {
    id: "notSupported",
    mark: "∅", // ∅ EMPTY SET
    glyphClass: "absence",
    tone: "slate",
    border: "solid",
    term: "not supported",
    legend:
      "this framework cannot support this feature; no probe is expected and none is counted",
  },
  notShipped: {
    id: "notShipped",
    mark: "·", // · MIDDLE DOT
    glyphClass: "absence",
    tone: "slate",
    border: "dashed",
    term: "not shipped",
    legend: "in scope, not built yet",
  },
  noData: {
    id: "noData",
    mark: "?",
    glyphClass: "absence",
    tone: "slate",
    border: "dotted",
    term: "no data",
    legend: "the probe is configured but has not reported for this cell yet",
  },
  gated: {
    id: "gated",
    mark: "—", // — EM DASH
    glyphClass: "absence",
    tone: "slate",
    border: "dotted",
    term: "not evaluated",
    legend: "a lower rung of the ladder is failing, so this rung was not run",
  },
  fault: {
    id: "fault",
    mark: "!",
    glyphClass: "absence",
    tone: "indigo",
    border: "solid",
    term: "check could not run",
    legend:
      "the worker pool was unreachable, the docs probe errored, or the dashboard could not build this cell — this says nothing about the integration",
  },
  requeued: {
    id: "requeued",
    mark: "⟳", // ⟳ CLOCKWISE OPEN CIRCLE ARROW
    glyphClass: "absence",
    tone: "slate",
    border: "dotted",
    term: "re-running",
    legend:
      "the job's lease lapsed and it was re-queued; where a previous result exists it stays on screen, in its own colour, until the new one lands",
  },
} as const;

/** Every glyph, in legend order: verdicts first, then absences. */
export const GLYPH_LIST: readonly GlyphSpec[] = [
  GLYPHS.pass,
  GLYPHS.degraded,
  GLYPHS.fail,
  GLYPHS.notSupported,
  GLYPHS.notShipped,
  GLYPHS.noData,
  GLYPHS.gated,
  GLYPHS.fault,
  GLYPHS.requeued,
];

/** The set of marks the renderer is allowed to emit. */
export const GLYPH_MARKS: readonly string[] = GLYPH_LIST.map((g) => g.mark);

const BY_MARK: ReadonlyMap<string, GlyphSpec> = new Map(
  GLYPH_LIST.map((g) => [g.mark, g]),
);

/**
 * Resolve a rendered mark back to its spec. Returns `undefined` for anything
 * outside the vocabulary (e.g. the level-strip's `U`/`W`/`C`/`T` letter chips,
 * or the health dimension's `up`/`down`/`stale` words), which callers render as
 * a plain filled chip.
 */
export function glyphForMark(mark: string): GlyphSpec | undefined {
  return BY_MARK.get(mark);
}

/** Convenience: is this mark an absence (must not read as a failure)? */
export function isAbsenceMark(mark: string): boolean {
  return glyphForMark(mark)?.glyphClass === "absence";
}

/**
 * The ONE tooltip line for a mark: the glyph, its term and its legend copy,
 * composed exactly as the legend row composes them, from exactly the same
 * fields. Nothing here is re-worded — a second copy of these strings is how
 * the previous legend came to describe states the code never emitted.
 *
 * Returns `undefined` for marks outside the vocabulary, which carry no
 * canonical meaning to state.
 */
export function glyphTitle(mark: string): string | undefined {
  const spec = glyphForMark(mark);
  return spec ? `${spec.mark} ${spec.term} — ${spec.legend}` : undefined;
}
