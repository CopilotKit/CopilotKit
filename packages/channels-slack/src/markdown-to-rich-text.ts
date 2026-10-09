import { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";

/**
 * Inline character styles Slack's `rich_text` elements can carry. Omitted
 * entirely (rather than set to `false`) when a run is unstyled, matching the
 * payload shape Slack itself emits.
 */
export interface RichTextStyle {
  bold?: true;
  italic?: true;
  strike?: true;
  code?: true;
}

/** A literal text run inside a `rich_text_section`. */
export interface RichTextTextRun {
  type: "text";
  text: string;
  style?: RichTextStyle;
}

/** A link run inside a `rich_text_section`. Renders clickable in Slack. */
export interface RichTextLinkRun {
  type: "link";
  url: string;
  text?: string;
  style?: RichTextStyle;
}

export type RichTextRun = RichTextTextRun | RichTextLinkRun;

/**
 * One pass over Slack's inline `mrkdwn` markup. Alternatives, in order:
 *
 *   1/2 `<url|label>` or `<url>`   → link
 *   3   `` `code` ``               → code run (contents are literal)
 *   4   `*bold*`
 *   5   `~strike~`
 *   6   `_italic_`
 *
 * The style markers require a non-word boundary outside and non-whitespace
 * inside, mirroring the italic rule in {@link markdownToMrkdwn} and Slack's
 * own behaviour, so `snake_case_names` and `2 * 3 * 4` are left alone.
 */
const INLINE_MRKDWN_SOURCE =
  /<([^<>|\n]+)(?:\|([^<>\n]*))?>|`([^`\n]+)`|(?<![\w*])\*(\S(?:[^*\n]*\S)?)\*(?![\w*])|(?<![\w~])~(\S(?:[^~\n]*\S)?)~(?![\w~])|(?<![\w_])_(\S(?:[^_\n]*\S)?)_(?![\w_])/
    .source;

/**
 * A fresh matcher per scan: `tokenize` recurses into nested markup, and a
 * shared sticky/global regex would have its `lastIndex` clobbered by the
 * inner scan.
 */
const inlineMatcher = () => new RegExp(INLINE_MRKDWN_SOURCE, "g");

/**
 * Convert the portable Markdown dialect into Slack `rich_text` runs.
 *
 * This deliberately routes through {@link markdownToMrkdwn} — the package's
 * single source of truth for what the portable dialect means — and then
 * tokenizes its output, which is Slack's own well-specified inline `mrkdwn`
 * syntax. That keeps one Markdown parser in the package instead of two
 * divergent ones; the step added here is a `mrkdwn` tokenizer, not a second
 * Markdown dialect.
 *
 * A side effect of going through `mrkdwn` is that inline markup a caller wrote
 * in Slack's syntax directly (`<https://x|y>`, `*bold*`) is honoured too,
 * which is what a caller writing it plainly wants.
 */
export function markdownToRichTextRuns(markdown: string): RichTextRun[] {
  if (!markdown) return [];
  return mergeAdjacent(tokenize(markdownToMrkdwn(markdown), {}));
}

/**
 * True when the runs need a `rich_text` cell to render faithfully — i.e. they
 * contain a link or any styled run. Plain runs render identically as
 * `raw_text`, so callers keep emitting that for them.
 */
export function needsRichText(runs: readonly RichTextRun[]): boolean {
  return runs.some(
    (run) => run.type === "link" || Object.keys(run.style ?? {}).length > 0,
  );
}

/**
 * Clamp the runs to `max` characters of *visible* text, mirroring
 * {@link truncateText}: an ellipsis replaces the last kept character only when
 * something was actually dropped.
 *
 * Link URLs are not counted — only the text a reader sees — and a link whose
 * label gets cut stays a link. Slack documents the cell budget as a text
 * length, and applying it to visible text is the reading that keeps a rich
 * cell and the equivalent plain cell truncating at the same place.
 */
export function truncateRuns(
  runs: readonly RichTextRun[],
  max: number,
): RichTextRun[] {
  const total = runs.reduce((sum, run) => sum + visibleText(run).length, 0);
  if (total <= max) return [...runs];

  const out: RichTextRun[] = [];
  let budget = max;
  for (const run of runs) {
    if (budget <= 0) break;
    const text = visibleText(run);
    if (text.length <= budget) {
      out.push(run);
      budget -= text.length;
      continue;
    }
    // This run straddles the limit: keep budget-1 chars plus the ellipsis so
    // the cell lands at exactly `max`, then stop.
    out.push(withText(run, text.slice(0, Math.max(0, budget - 1)) + "…"));
    budget = 0;
  }
  return out;
}

function visibleText(run: RichTextRun): string {
  return run.text ?? "";
}

function withText(run: RichTextRun, text: string): RichTextRun {
  return { ...run, text };
}

function tokenize(input: string, inherited: RichTextStyle): RichTextRun[] {
  const runs: RichTextRun[] = [];
  const pushText = (text: string) => {
    if (text.length > 0) runs.push(styled({ type: "text", text }, inherited));
  };

  let last = 0;
  const re = inlineMatcher();
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    pushText(input.slice(last, match.index));
    last = match.index + match[0].length;

    const [, url, label, code, bold, strike, italic] = match;
    if (url !== undefined) {
      const inner =
        label === undefined || label === ""
          ? undefined
          : tokenize(label, inherited);
      const link: RichTextLinkRun = { type: "link", url };
      if (inner) {
        link.text = inner.map(visibleText).join("");
        // A Slack link element carries one style, so per-run styling inside a
        // label collapses to the union of the styles found in it.
        const style = unionStyle(inner);
        if (Object.keys(style).length > 0) link.style = style;
      }
      runs.push(link);
    } else if (code !== undefined) {
      // Code spans are literal: no nested markup.
      runs.push(
        styled({ type: "text", text: code }, { ...inherited, code: true }),
      );
    } else if (bold !== undefined) {
      runs.push(...tokenize(bold, { ...inherited, bold: true }));
    } else if (strike !== undefined) {
      runs.push(...tokenize(strike, { ...inherited, strike: true }));
    } else if (italic !== undefined) {
      runs.push(...tokenize(italic, { ...inherited, italic: true }));
    }
  }
  pushText(input.slice(last));
  return runs;
}

function styled(run: RichTextTextRun, style: RichTextStyle): RichTextTextRun {
  return Object.keys(style).length > 0 ? { ...run, style: { ...style } } : run;
}

function unionStyle(runs: readonly RichTextRun[]): RichTextStyle {
  const style: RichTextStyle = {};
  for (const run of runs) {
    if (run.style?.bold) style.bold = true;
    if (run.style?.italic) style.italic = true;
    if (run.style?.strike) style.strike = true;
    if (run.style?.code) style.code = true;
  }
  return style;
}

/** Collapse neighbouring text runs that share a style into one run. */
function mergeAdjacent(runs: readonly RichTextRun[]): RichTextRun[] {
  const out: RichTextRun[] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      prev.type === "text" &&
      run.type === "text" &&
      sameStyle(prev.style, run.style)
    ) {
      out[out.length - 1] = { ...prev, text: prev.text + run.text };
      continue;
    }
    out.push(run);
  }
  return out;
}

function sameStyle(a: RichTextStyle | undefined, b: RichTextStyle | undefined) {
  return (
    !!a?.bold === !!b?.bold &&
    !!a?.italic === !!b?.italic &&
    !!a?.strike === !!b?.strike &&
    !!a?.code === !!b?.code
  );
}
