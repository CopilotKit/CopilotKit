import type { BotNode } from "@copilotkit/channels-ui";
import type { TelegramInlineButton, TelegramPayload } from "../types.js";
import { telegramHtml, escapeHtml } from "../telegram-html.js";
import {
  TELEGRAM_LIMITS,
  truncateText,
  clampArray,
  byteLen,
} from "./budget.js";

/**
 * The structural HTML wrapper a node placed around its line, if any. Stored on
 * each {@link LineEntry} so a truncated last line can be re-wrapped
 * deterministically (Bug 3) instead of reverse-engineered from the html string.
 *
 *  - "b"   → header: `<b>…escaped…</b>`
 *  - "i"   → context/input: `<i>…telegramHtml…</i>`
 *  - "pre" → table: `<pre>…escaped…</pre>`
 *  - "none"/undefined → inline telegramHtml output (section/markdown/text/
 *    fields/raw/divider) — the html IS already balanced inline markup.
 */
type WrapKind = "b" | "i" | "pre" | "code" | "none";

/** A single rendered line: its pre-HTML source, its HTML, and its wrapper. */
interface LineEntry {
  raw: string;
  html: string;
  wrap?: WrapKind;
}

/**
 * Render a cross-platform component IR tree into a Telegram Bot API payload.
 *
 * The renderer is total: unknown intrinsic types are skipped rather than
 * throwing. Telegram limits are enforced via {@link truncateText},
 * {@link clampArray}, and {@link byteLen}.
 */
export function renderTelegram(ir: BotNode[]): TelegramPayload {
  // Each entry holds the pre-HTML (raw) text and the corresponding HTML for a
  // line. Separating them lets us apply the character budget to SOURCE text
  // before HTML conversion, so the emitted HTML is always well-formed.
  const lineEntries: LineEntry[] = [];
  const inlineKeyboard: TelegramInlineButton[][] = [];
  const photos: { url: string; caption?: string }[] = [];

  for (const node of ir) {
    renderNode(node, lineEntries, inlineKeyboard, photos);
  }

  // Build the HTML, enforcing the message-text budget on the joined RAW text
  // (before HTML conversion) so the emitted HTML is always well-formed.
  //
  // Bug 2: the budget is measured in RAW chars, but the emitted payload is
  // HTML — `<b>`, `<a href>`, and `&amp;`/`&lt;` entity expansion add length
  // that the raw budget does not count. A near-4096 raw message with heavy
  // markup can therefore exceed Telegram's 4096-char hard limit once converted
  // ("message is too long", not caught by the format fallback). We bound the
  // raw text first, then, if the resulting HTML still exceeds the limit,
  // iteratively shrink the raw budget until the HTML fits — and apply a final
  // hard guard that slices the HTML at a safe tag/entity boundary if needed.
  const rawJoined = lineEntries.map((e) => e.raw).join("\n");
  const LIMIT = TELEGRAM_LIMITS.messageText;

  let rawBudget: number = LIMIT;
  let text = buildBoundedHtml(lineEntries, rawJoined, rawBudget);

  // Iteratively reduce the raw budget while the HTML overshoots the limit. Each
  // pass cuts the budget proportionally to the observed overshoot (plus a small
  // constant) so we converge quickly even under ~5x entity expansion.
  let guard = 0;
  while (text.length > LIMIT && rawBudget > 0 && guard < 32) {
    const overshoot = text.length - LIMIT;
    // Shrink by at least the overshoot (markup is at least 1:1) plus headroom.
    rawBudget = Math.max(0, rawBudget - overshoot - 16);
    text = buildBoundedHtml(lineEntries, rawJoined, rawBudget);
    guard++;
  }

  // Final hard guard: if the HTML is still over (pathological markup density),
  // slice it at a safe boundary that never splits a tag or an entity.
  if (text.length > LIMIT) {
    text = sliceHtmlSafely(text, LIMIT);
  }

  const result: TelegramPayload = { text, parseMode: "HTML" };
  if (inlineKeyboard.length > 0) result.inlineKeyboard = inlineKeyboard;
  if (photos.length > 0) result.photos = photos;

  return result;
}

/**
 * Build the joined HTML for `lineEntries`, enforcing a raw-character budget on
 * the source text. Full lines reuse their pre-computed html; the last
 * (possibly truncated) line is re-rendered from its raw slice. Returns
 * well-formed HTML (no split tag/entity) whose underlying raw content is
 * ≤ `rawBudget` chars.
 */
function buildBoundedHtml(
  lineEntries: LineEntry[],
  rawJoined: string,
  rawBudget: number,
): string {
  const rawBounded = truncateText(rawJoined, rawBudget);
  const wasTruncated = rawBounded.length !== rawJoined.length;

  if (!wasTruncated) {
    // Nothing was truncated — use the pre-computed HTML directly.
    return lineEntries.map((e) => e.html).join("\n");
  }

  // Some lines were cut. `rawBounded` ends with a trailing "…" marker that
  // truncateText appended (occupying one char of the budget but NOT present in
  // the source entries). Strip it to recover the exact char budget of real
  // content, walk the entries against that budget, then re-append "…" to the
  // final emitted slice so the marker is preserved and the reconstructed raw
  // length stays within budget.
  const ELLIPSIS = "…";
  const contentBudget = rawBounded.endsWith(ELLIPSIS)
    ? rawBounded.length - 1
    : rawBounded.length;

  const htmlParts: string[] = [];
  let remaining = contentBudget;
  let markerEmitted = false;
  for (const entry of lineEntries) {
    if (remaining <= 0) break;
    if (entry.raw.length <= remaining) {
      htmlParts.push(entry.html);
      remaining -= entry.raw.length;
      if (remaining > 0) remaining -= 1; // account for the "\n" separator
    } else {
      // This entry is partially truncated — re-render the bounded raw slice
      // and append the ellipsis marker so dropped content is signalled.
      const slicedRaw = entry.raw.slice(0, remaining);
      htmlParts.push(reRenderRawLine(slicedRaw, entry) + ELLIPSIS);
      markerEmitted = true;
      break;
    }
  }
  // If the cut fell exactly on a line boundary (no partial line was emitted),
  // the marker would otherwise be lost. Append it to the last emitted line.
  if (!markerEmitted && htmlParts.length > 0) {
    htmlParts[htmlParts.length - 1] += ELLIPSIS;
  }
  return htmlParts.join("\n");
}

/**
 * Re-render a truncated raw slice using the structural wrapper the original
 * node recorded on the entry (Bug 3). Using the stored {@link WrapKind} —
 * rather than reverse-engineering it from the html via regex — guarantees the
 * truncated slice is re-wrapped balanced and correctly styled, even for lines
 * whose html is NOT a single top-level wrapper (e.g. `<i>a</i> b <i>c</i>` or
 * a `<b>Label</b> value` field).
 */
function reRenderRawLine(slicedRaw: string, entry: LineEntry): string {
  switch (entry.wrap) {
    case "pre":
      // Table/preformatted block: the slice is plain text — escape it and wrap
      // in a balanced <pre>. (telegramHtml would re-interpret markdown that the
      // original grid never had.)
      return `<pre>${escapeHtml(slicedRaw)}</pre>`;
    case "code":
      return `<code>${escapeHtml(slicedRaw)}</code>`;
    case "b":
      // Header: original html was `<b>${escapeHtml(raw)}</b>`. Re-escape the
      // slice (NOT telegramHtml — headers are plain text, not markdown).
      return `<b>${escapeHtml(slicedRaw)}</b>`;
    case "i":
      // Context/input: original html was `<i>${telegramHtml(raw)}</i>`.
      return `<i>${telegramHtml(slicedRaw)}</i>`;
    case "none":
    case undefined:
    default:
      // Inline telegramHtml output (section/markdown/text/fields/raw/divider) —
      // the html is already balanced inline markup; re-run telegramHtml on the
      // slice for the same well-formed result.
      return telegramHtml(slicedRaw);
  }
}

/**
 * Hard guard for the pathological case where, even after shrinking the raw
 * budget, the HTML still exceeds `limit` (extreme markup density). Slice the
 * HTML to at most `limit` chars at a boundary that never splits an open tag or
 * an `&entity;` — by trimming back to before the last unterminated `<` or `&`.
 * Note: this is a last-resort safety net; balanced-tag invariants are upheld by
 * the raw-budget path above, so in practice it is rarely hit.
 */
function sliceHtmlSafely(html: string, limit: number): string {
  if (html.length <= limit) return html;
  let cut = html.slice(0, limit);
  // If we cut inside an unterminated tag (`…<b` / `…<`), trim back to before
  // the `<`.
  const lastLt = cut.lastIndexOf("<");
  const lastGt = cut.lastIndexOf(">");
  if (lastLt > lastGt) cut = cut.slice(0, lastLt);
  // If we cut inside an unterminated entity (`…&am` / `…&`), trim back to
  // before the `&`.
  const lastAmp = cut.lastIndexOf("&");
  const lastSemi = cut.lastIndexOf(";");
  if (lastAmp > lastSemi) cut = cut.slice(0, lastAmp);
  return cut;
}

/** Render a single IR node, appending to lineEntries/inlineKeyboard/photos. */
function renderNode(
  node: BotNode,
  lineEntries: LineEntry[],
  inlineKeyboard: TelegramInlineButton[][],
  photos: { url: string; caption?: string }[],
): void {
  if (typeof node.type !== "string") return; // non-intrinsic — skip silently
  const props = node.props ?? {};

  /**
   * Push a line, recording the structural wrapper (Bug 3) so a truncated last
   * line can be re-wrapped deterministically. `wrap` defaults to "none" for
   * lines whose html is inline telegramHtml output.
   */
  const pushLine = (raw: string, html: string, wrap: WrapKind = "none") =>
    lineEntries.push({ raw, html, wrap });
  /** Push an inline-html line (no structural wrapper). */
  const pushRaw = (raw: string, html: string) => pushLine(raw, html, "none");

  switch (node.type) {
    case "message": {
      // Container — flatten children.
      for (const child of childNodes(node)) {
        renderNode(child, lineEntries, inlineKeyboard, photos);
      }
      return;
    }
    case "header": {
      const raw = truncateText(collectText(node), 256);
      pushLine(raw, `<b>${escapeHtml(raw)}</b>`, "b");
      return;
    }
    case "section":
    case "markdown": {
      const raw = collectText(node);
      pushRaw(raw, telegramHtml(raw));
      return;
    }
    case "text": {
      // collectText on a text node returns props.value directly.
      const raw = collectText(node);
      pushRaw(raw, telegramHtml(raw));
      return;
    }
    case "fields": {
      const fieldChildren = childNodes(node).filter((c) => c.type === "field");
      for (const f of fieldChildren) {
        const fieldProps = f.props ?? {};
        const label = fieldProps.label as string | undefined;
        const children = childNodes(f);
        if (label) {
          // Has a label: <b>label</b> value
          const valueText = collectText(f);
          const raw = `${label} ${valueText}`;
          pushRaw(
            raw,
            `<b>${escapeHtml(label)}</b> ${telegramHtml(valueText)}`,
          );
        } else if (
          children.length === 1 &&
          children[0] &&
          children[0].type === "text"
        ) {
          // Single text child — bold it.
          const raw = collectText(f);
          pushRaw(raw, `<b>${telegramHtml(raw)}</b>`);
        } else {
          const raw = collectText(f);
          pushRaw(raw, telegramHtml(raw));
        }
      }
      return;
    }
    case "field": {
      const fieldProps = props;
      const label = fieldProps.label as string | undefined;
      const children = childNodes(node);
      if (label) {
        const valueText = collectText(node);
        const raw = `${label} ${valueText}`;
        pushRaw(raw, `<b>${escapeHtml(label)}</b> ${telegramHtml(valueText)}`);
      } else if (
        children.length === 1 &&
        children[0] &&
        children[0].type === "text"
      ) {
        const raw = collectText(node);
        pushRaw(raw, `<b>${telegramHtml(raw)}</b>`);
      } else {
        const raw = collectText(node);
        pushRaw(raw, telegramHtml(raw));
      }
      return;
    }
    case "context": {
      const raw = collectText(node);
      pushLine(raw, `<i>${telegramHtml(raw)}</i>`, "i");
      return;
    }
    case "divider": {
      pushRaw("──────", "──────");
      return;
    }
    case "image": {
      const url = (props.url ?? props.image_url) as string | undefined;
      const alt = (props.alt ?? props.altText ?? "") as string;
      if (url) {
        // Bug 3 fix: cap caption to TELEGRAM_LIMITS.caption (1024 chars).
        const caption = alt
          ? truncateText(alt, TELEGRAM_LIMITS.caption)
          : undefined;
        const { items } = clampArray(
          [...photos, { url, caption }],
          TELEGRAM_LIMITS.photosPerMessage,
        );
        photos.splice(0, photos.length, ...items);
      }
      return;
    }
    case "actions": {
      const buttons: TelegramInlineButton[] = childNodes(node)
        .map(renderActionButton)
        .filter((b): b is TelegramInlineButton => b !== null);
      // Bug 4 fix: cap against the running total across the whole keyboard, not
      // per-node, so multiple actions/select blocks can't exceed the limit.
      appendButtons(inlineKeyboard, buttons);
      return;
    }
    case "select": {
      const options =
        (props.options as
          | { label: string; value: unknown; id?: string }[]
          | undefined) ?? [];
      // Bug 2 fix: degrade (skip) options whose callback_data exceeds 64 bytes
      // instead of throwing — keeps the rest of the message intact.
      // Consistency: use JSON.stringify(value) (same as actionIdOf) when no id.
      const buttons: TelegramInlineButton[] = options
        .map((o): TelegramInlineButton | null => {
          const callbackData = o.id ? o.id : JSON.stringify(o.value);
          if (byteLen(callbackData) > TELEGRAM_LIMITS.callbackData) {
            return null; // degrade: skip this option silently
          }
          return {
            text: truncateText(
              String(o.label ?? ""),
              TELEGRAM_LIMITS.buttonText,
            ),
            callbackData,
          };
        })
        .filter((b): b is TelegramInlineButton => b !== null);
      // Bug 4 fix: cap against the running keyboard total (see "actions").
      appendButtons(inlineKeyboard, buttons);
      return;
    }
    case "input": {
      const raw = "(open the chat to type your answer)";
      pushLine(raw, `<i>${escapeHtml(raw)}</i>`, "i");
      return;
    }
    case "table": {
      // Render as monospace <pre> grid.
      const columnsProp = props.columns as { header: string }[] | undefined;

      const rowNodes = childNodes(node).filter((c) => c.type === "row");
      const tableRows: string[][] = [];

      if (columnsProp && columnsProp.length > 0) {
        tableRows.push(columnsProp.map((c) => c.header));
      }

      for (const rowNode of rowNodes) {
        const cells = childNodes(rowNode).filter((c) => c.type === "cell");
        tableRows.push(cells.map((cell) => collectText(cell)));
      }

      if (tableRows.length > 0) {
        // Compute column widths.
        const colCount = Math.max(...tableRows.map((r) => r.length));
        const colWidths: number[] = Array(colCount).fill(0);
        for (const row of tableRows) {
          for (let i = 0; i < row.length; i++) {
            colWidths[i] = Math.max(colWidths[i] ?? 0, (row[i] ?? "").length);
          }
        }
        const gridLines = tableRows.map((row) =>
          row.map((cell, i) => cell.padEnd(colWidths[i] ?? 0)).join("  "),
        );
        const rawGrid = gridLines.join("\n");
        pushLine(rawGrid, `<pre>${escapeHtml(rawGrid)}</pre>`, "pre");
      }
      return;
    }
    case "raw": {
      const value = props.value;
      if (
        value !== null &&
        typeof value === "object" &&
        "text" in (value as object)
      ) {
        const rawText = (value as { text?: unknown }).text;
        if (typeof rawText === "string") {
          pushRaw(rawText, telegramHtml(rawText));
          return;
        }
      }
      const rawStr = JSON.stringify(value);
      pushRaw(rawStr, telegramHtml(rawStr));
      return;
    }
    default:
      // Unknown intrinsic — skip silently (total renderer).
      return;
  }
}

/**
 * Append buttons to the inline keyboard, chunked into rows of buttonsPerRow,
 * while enforcing {@link TELEGRAM_LIMITS.buttonsPerMessage} across the ENTIRE
 * keyboard (Bug 4). Counts buttons already present from prior actions/select
 * nodes and silently drops any overflow rather than throwing — Telegram would
 * otherwise reject the whole message.
 */
function appendButtons(
  inlineKeyboard: TelegramInlineButton[][],
  buttons: TelegramInlineButton[],
): void {
  const alreadyAdded = inlineKeyboard.reduce((sum, row) => sum + row.length, 0);
  const capacity = TELEGRAM_LIMITS.buttonsPerMessage - alreadyAdded;
  if (capacity <= 0) return;
  const accepted = buttons.slice(0, capacity);
  for (let i = 0; i < accepted.length; i += TELEGRAM_LIMITS.buttonsPerRow) {
    inlineKeyboard.push(accepted.slice(i, i + TELEGRAM_LIMITS.buttonsPerRow));
  }
}

/** Render one button node for an inline keyboard. Returns null for non-renderable nodes. */
function renderActionButton(node: BotNode): TelegramInlineButton | null {
  if (typeof node.type !== "string") return null;
  if (node.type !== "button") return null;

  const props = node.props ?? {};
  const buttonText = truncateText(
    collectText(node),
    TELEGRAM_LIMITS.buttonText,
  );

  if (props.url) {
    return { text: buttonText, url: props.url as string };
  }

  const id = actionIdOf(props);
  // Bug 2 fix: degrade (skip) buttons whose callback_data exceeds 64 bytes
  // instead of throwing — keeps the rest of the message intact.
  if (byteLen(id) > TELEGRAM_LIMITS.callbackData) {
    return null;
  }
  return { text: buttonText, callbackData: id };
}

/** Derive callback data: prefer registry-stamped id, else value, else "action". */
function actionIdOf(props: Record<string, unknown>): string {
  const onClick = props.onClick;
  if (onClick != null && "id" in (onClick as object)) {
    const id = (onClick as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  if (props.value !== undefined) {
    return JSON.stringify(props.value);
  }
  return "action";
}

/** The expanded `children` of an IR node as a `BotNode[]` (empty if none). */
function childNodes(node: BotNode): BotNode[] {
  const children = node.props?.children;
  if (Array.isArray(children)) return children as BotNode[];
  if (
    children &&
    typeof children === "object" &&
    "type" in (children as object)
  ) {
    return [children as BotNode];
  }
  return [];
}

/** Concatenate the `value` of all descendant `text` nodes (depth-first). */
function collectText(node: BotNode): string {
  if (typeof node.type === "string" && node.type === "text") {
    return String(node.props?.value ?? "");
  }
  let acc = "";
  for (const child of childNodes(node)) {
    acc += collectText(child);
  }
  return acc;
}
