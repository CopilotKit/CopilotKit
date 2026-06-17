import type { BotNode } from "@copilotkit/bot-ui";
import { GCHAT_LIMITS, truncateText, clampArray } from "./budget.js";

type Widget = Record<string, unknown>;

/** Escape the HTML-significant characters so user text can't inject markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert the agent's standard Markdown into the limited HTML subset that
 * Google Chat card `textParagraph`/`decoratedText` widgets render.
 *
 *   Markdown      →  Card HTML
 *   **bold**      →  <b>bold</b>
 *   __bold__      →  <b>bold</b>
 *   *italic*      →  <i>italic</i>
 *   _italic_      →  <i>italic</i>
 *   ~~strike~~    →  <s>strike</s>
 *   # heading     →  <b>heading</b>
 *   [text](url)   →  <a href="url">text</a>
 *   newline       →  <br>
 *
 * Inline `` `code` `` and fenced code keep their backticks literal — card text
 * has no code style, but the renderer must never crash on them. Code regions
 * are pulled out first so their contents aren't reinterpreted as Markdown.
 *
 * Bold is converted into non-printing control-character sentinels (\x11/\x12)
 * before italic runs, mirroring `markdown.ts`, so the single-asterisk italic
 * pass can't eat the inner text of a `**bold**` span.
 */
export function markdownToCardHtml(input: string): string {
  if (!input) return input;

  // ── 1. Pull code regions out so their contents aren't reinterpreted. ──
  // The code placeholder is wrapped in the non-printing control byte \x10, and
  // the bold sentinels below are the control bytes \x11 (open) / \x12 (close).
  // All three are real, load-bearing, collision-proof bytes — invisible in most
  // editors but deliberately chosen so they can never appear in real user input.
  // Do NOT replace them with visible text. Any markdown-style transform in this
  // package MUST use these control-byte sentinels (see markdown.ts) to avoid
  // colliding with user text.
  const codeRegions: string[] = [];
  const codePlaceholder = (i: number) => `\x10CODE${i}\x10`;

  let body = input.replace(/```[\s\S]*?```/g, (match) => {
    codeRegions.push(match);
    return codePlaceholder(codeRegions.length - 1);
  });
  body = body.replace(/`[^`\n]*`/g, (match) => {
    codeRegions.push(match);
    return codePlaceholder(codeRegions.length - 1);
  });

  // ── 2. Escape HTML so the only markup is the tags we emit below. ──
  body = escapeHtml(body);

  // ── 3. Bold first, into sentinels; italic then can't eat its output. ──
  const BOLD_OPEN = "\x11";
  const BOLD_CLOSE = "\x12";
  body = body.replace(/\*\*([^\n*]+?)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);
  body = body.replace(/__([^\n_]+?)__/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);

  // Headings (#…) → bold. Strip any inner bold sentinels first so the line
  // doesn't carry nested pairs.
  const boldSentinel = new RegExp(`[${BOLD_OPEN}${BOLD_CLOSE}]`, "g");
  body = body.replace(
    /^\s{0,3}#{1,6}\s+(.*)$/gm,
    (_m, text: string) =>
      `${BOLD_OPEN}${text.replace(boldSentinel, "").trim()}${BOLD_CLOSE}`,
  );

  // Strikethrough ~~text~~ → <s>text</s>
  body = body.replace(/~~([^\n~]+?)~~/g, "<s>$1</s>");

  // Italic *text* → <i>text</i> (skip already-converted bold sentinels).
  body = body.replace(
    /(^|[^*\w])\*(\S(?:[^*\n]*\S)?)\*(?!\w)/g,
    "$1<i>$2</i>",
  );
  // Italic _text_ → <i>text</i>
  body = body.replace(/(^|[^_\w])_(\S(?:[^_\n]*\S)?)_(?!\w)/g, "$1<i>$2</i>");

  // Markdown links [text](url) → <a href="url">text</a>. The url was escaped
  // above; re-escape the quote just in case and keep it inside the attribute.
  body = body.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (_m, t: string, u: string) => `<a href="${u.replace(/"/g, "&quot;")}">${t}</a>`,
  );

  // ── 4. Restore bold sentinels and code regions, then newlines → <br>. ──
  body = body.replace(new RegExp(BOLD_OPEN, "g"), "<b>");
  body = body.replace(new RegExp(BOLD_CLOSE, "g"), "</b>");
  body = body.replace(
    /\x10CODE(\d+)\x10/g,
    (_m, idx) => escapeHtml(codeRegions[Number(idx)] ?? ""),
  );
  body = body.replace(/\r?\n/g, "<br>");

  return body;
}

/** The expanded children of an IR node as a BotNode[] (empty if none). */
function childrenOf(node: BotNode): BotNode[] {
  const c = node.props?.children;
  if (Array.isArray(c)) return c as BotNode[];
  if (c && typeof c === "object" && "type" in (c as object)) return [c as BotNode];
  return [];
}

/** Concatenate the text of all descendant `text` nodes (depth-first). */
function collectText(node: BotNode): string {
  if (typeof node.type === "string" && node.type === "text") {
    return String(node.props?.value ?? "");
  }
  return childrenOf(node).map(collectText).join(" ").trim();
}

/** True when the IR is a list of only plain text nodes — render as `{ text }` instead of a card. */
function isPlainText(ir: BotNode[]): boolean {
  return ir.every((n) => n.type === "text");
}

/** Extract the `ck:` action id stamped onto an event prop by the action registry, if present. */
function idFromHandler(handler: unknown): string | undefined {
  if (handler && typeof handler === "object" && "id" in (handler as object)) {
    const id = (handler as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/**
 * Derive a button's Google Chat `onClick.action.function` id: prefer the
 * registry-stamped ck: id, else a fallback that stays unique per button.
 *
 * The fallback incorporates the button's `index` within its action set so two
 * handler-less buttons that share a value (or both lack one) still emit
 * distinct function ids — `decodeInteraction` keys `InteractionEvent.id` off
 * this field, so collisions would make clicks indistinguishable.
 */
function buttonFunctionId(props: Record<string, unknown>, index: number): string {
  const fromHandler = idFromHandler(props.onClick);
  if (fromHandler) return fromHandler;
  return props.value !== undefined
    ? `${JSON.stringify(props.value)}:${index}`
    : `ck-fallback-${index}`;
}

/** Render an `actions` node into a `buttonList` widget, or return null if no buttons. */
function renderActionsWidget(node: BotNode): Widget | null {
  const buttonNodes = childrenOf(node).filter(
    (c) => typeof c.type === "string" && c.type === "button",
  );
  const { items, overflow } = clampArray(buttonNodes, GCHAT_LIMITS.buttonsPerSet);
  if (items.length === 0) return null;

  // A buttonList can't carry a text note, so the dropped buttons can't be
  // surfaced in-card — at least warn so it's debuggable.
  if (overflow > 0) {
    console.warn(
      `[bot-google-chat] cardsV2 button set exceeded ${GCHAT_LIMITS.buttonsPerSet} buttons; dropped ${overflow} (card "ck-card").`,
    );
  }

  const buttons = items.map((btn, index) => {
    const props = btn.props ?? {};
    const functionId = buttonFunctionId(props, index);
    // Omit the `value` parameter entirely when there's no value — emitting
    // `{ key: "value", value: "" }` makes decodeInteraction read `""` (and
    // JSON.parse("") throws → value becomes ""), so a value-less click would
    // surface `value === ""` instead of `undefined`.
    const parameters =
      props.value !== undefined
        ? [{ key: "value", value: JSON.stringify(props.value) }]
        : [];
    const buttonObj: Record<string, unknown> = {
      text: truncateText(collectText(btn), GCHAT_LIMITS.buttonText),
      onClick: {
        action: {
          function: functionId,
          parameters,
        },
      },
    };
    return buttonObj;
  });

  return { buttonList: { buttons } };
}

/** Render a single IR node into zero or more widgets. */
function renderNodeWidgets(node: BotNode): Widget[] {
  if (typeof node.type !== "string") return [];
  const widgets: Widget[] = [];

  switch (node.type) {
    case "message": {
      // Flatten message container children.
      for (const child of childrenOf(node)) {
        widgets.push(...renderNodeWidgets(child));
      }
      break;
    }
    case "header": {
      // Header is handled separately at the card level; skip here to avoid duplication.
      break;
    }
    case "section":
    case "markdown": {
      const txt = truncateText(collectText(node), GCHAT_LIMITS.textParagraph);
      if (txt) widgets.push({ textParagraph: { text: markdownToCardHtml(txt) } });
      // Render any nested actions/button children as a buttonList widget.
      for (const child of childrenOf(node)) {
        if (typeof child.type === "string" && child.type === "actions") {
          const w = renderActionsWidget(child);
          if (w) widgets.push(w);
        }
      }
      break;
    }
    case "actions": {
      const w = renderActionsWidget(node);
      if (w) widgets.push(w);
      break;
    }
    case "divider": {
      widgets.push({ divider: {} });
      break;
    }
    case "image": {
      const props = node.props ?? {};
      const url = (props.url ?? props.image_url) as string | undefined;
      const alt = (props.alt ?? props.altText ?? "") as string;
      // The Chat cardsV2 API rejects an image widget with an empty/invalid
      // imageUrl, which would fail the entire create/patch. The renderer is
      // total — skip a url-less image like we skip empty-text widgets.
      if (!url) break;
      widgets.push({ image: { imageUrl: url, altText: alt } });
      break;
    }
    case "context": {
      const txt = truncateText(collectText(node), GCHAT_LIMITS.textParagraph);
      // Context is rendered de-emphasized (italic).
      if (txt) widgets.push({ textParagraph: { text: `<i>${markdownToCardHtml(txt)}</i>` } });
      break;
    }
    case "fields": {
      const fieldChildren = childrenOf(node).filter((c) => c.type === "field");
      for (const f of fieldChildren) {
        // `decoratedText` REQUIRES `text`; `topLabel` is only an optional
        // adornment above it. The field's content goes in `text`.
        const txt = truncateText(collectText(f), GCHAT_LIMITS.decoratedTextTop);
        if (txt) widgets.push({ decoratedText: { text: markdownToCardHtml(txt) } });
      }
      break;
    }
    case "field": {
      // `decoratedText` REQUIRES `text`; put the field's content there.
      const txt = truncateText(collectText(node), GCHAT_LIMITS.decoratedTextTop);
      if (txt) widgets.push({ decoratedText: { text: markdownToCardHtml(txt) } });
      break;
    }
    case "text": {
      const value = String((node.props ?? {}).value ?? "");
      if (value) {
        widgets.push({
          textParagraph: {
            text: markdownToCardHtml(
              truncateText(value, GCHAT_LIMITS.textParagraph),
            ),
          },
        });
      }
      break;
    }
    default:
      // Unknown intrinsic — skip silently (total renderer).
      break;
  }

  return widgets;
}

/**
 * Render a cross-platform component IR tree into a Google Chat message body.
 *
 * - Plain text-only IR (all `text` nodes) → `{ text }` (no card).
 * - Structured IR → `{ cardsV2: [{ cardId, card: { header?, sections } }] }`.
 *
 * Per-element Chat limits are applied via `truncateText` and `clampArray`; the
 * renderer is total — unknown node types are skipped rather than throwing.
 */
export function renderGoogleChatMessage(ir: BotNode[]): {
  cardsV2?: unknown[];
  text?: string;
} {
  // Flatten a top-level <message> container.
  const nodes =
    ir.length === 1 && ir[0]?.type === "message" ? childrenOf(ir[0]) : ir;

  if (isPlainText(nodes)) {
    const plain = nodes.map(collectText).join("\n").trim();
    return { text: plain || " " };
  }

  // Pull the first header node for the card header.
  const headerNode = nodes.find((n) => n.type === "header");
  const bodyNodes = nodes.filter((n) => n.type !== "header");

  const widgets: Widget[] = bodyNodes.flatMap(renderNodeWidgets);

  // Clamp widgets to the per-card budget. When some overflow, reserve one slot
  // for a trailing indicator so the truncation is visible (and still respects
  // the limit), and warn so it's diagnosable.
  let clampedWidgets: Widget[];
  {
    const limit = GCHAT_LIMITS.widgetsPerCard;
    const overflow = widgets.length > limit ? widgets.length - limit : 0;
    if (overflow > 0) {
      const reserved = clampArray(widgets, limit - 1);
      const hidden = reserved.overflow;
      clampedWidgets = [
        ...reserved.items,
        { textParagraph: { text: `… ${hidden} more not shown` } },
      ];
      console.warn(
        `[bot-google-chat] cardsV2 card exceeded ${limit} widgets; ${hidden} not shown (card "ck-card").`,
      );
    } else {
      clampedWidgets = clampArray(widgets, limit).items;
    }
  }

  // A section with an empty `widgets: []` array is rejected by the Chat API.
  // If nothing rendered to a widget (all nodes were unknown/empty) and there
  // is no header to carry the card, fall back to a plain text body.
  if (clampedWidgets.length === 0 && !headerNode) {
    return { text: " " };
  }

  const card: Record<string, unknown> = {};

  if (headerNode) {
    card.header = {
      title: truncateText(collectText(headerNode), GCHAT_LIMITS.headerText),
    };
  }

  // Only emit a section when there are widgets; an empty `widgets: []` is invalid.
  if (clampedWidgets.length > 0) {
    card.sections = [{ widgets: clampedWidgets }];
  }

  return { cardsV2: [{ cardId: "ck-card", card }] };
}

/** Alias used by the adapter's render(); returns the same `{ cardsV2 }` or `{ text }` body. */
export function renderCardsV2(
  ir: BotNode[],
): { cardsV2?: unknown[]; text?: string } {
  return renderGoogleChatMessage(ir);
}
