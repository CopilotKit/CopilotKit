import type { ChannelNode } from "@copilotkit/channels-ui";
import { GCHAT_LIMITS, truncateText, clampArray } from "./budget.js";
import { markdownToChat } from "../markdown.js";

type Widget = Record<string, unknown>;

/** Escape the HTML-significant characters so user text can't inject markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Allow only safe link schemes. Permits http:, https:, and mailto:
 * (case-insensitive), scheme-relative `//host` URLs, and relative URLs with
 * no scheme at all (no `:` before the first `/`, `?`, or `#`). Any other
 * scheme (javascript:, data:, vbscript:, file:, …) is rejected.
 */
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) return true; // scheme-relative
  const colon = trimmed.indexOf(":");
  if (colon === -1) return true; // no scheme → relative
  const slash = trimmed.indexOf("/");
  const question = trimmed.indexOf("?");
  const hash = trimmed.indexOf("#");
  const beforeDelimiter = (d: number) => d === -1 || colon < d;
  if (
    beforeDelimiter(slash) &&
    beforeDelimiter(question) &&
    beforeDelimiter(hash)
  ) {
    const scheme = trimmed.slice(0, colon).toLowerCase();
    return scheme === "http" || scheme === "https" || scheme === "mailto";
  }
  return true;
}

/** Cards v2 loads images only from absolute HTTPS URLs. */
function isAbsoluteHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
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

  // ── 0. Strip the sentinel control bytes from the input. ──
  // The placeholders/sentinels below use the non-printing control bytes \x10
  // (code), \x11 (bold open), \x12 (bold close). They are collision-proof
  // ONLY BECAUSE we remove any pre-existing occurrences from the input here
  // first — input CAN contain them (rare, but possible in pasted/LLM content)
  // and leaving them in would corrupt the placeholder/restore passes.
  const sanitized = input.replace(/[\x10\x11\x12]/g, "");

  // ── 1. Pull code regions out so their contents aren't reinterpreted. ──
  // The code placeholder is wrapped in the non-printing control byte \x10, and
  // the bold sentinels below are the control bytes \x11 (open) / \x12 (close).
  // All three are real, load-bearing, collision-proof bytes — invisible in most
  // editors but deliberately chosen so they can never appear in real user input
  // (the input is stripped of them first, see step 0). Do NOT replace them with
  // visible text. Any markdown-style transform in this package MUST use these
  // control-byte sentinels (see markdown.ts) to avoid colliding with user text.
  const codeRegions: string[] = [];
  const codePlaceholder = (i: number) => `\x10CODE${i}\x10`;

  let body = sanitized.replace(/```[\s\S]*?```/g, (match) => {
    codeRegions.push(match);
    return codePlaceholder(codeRegions.length - 1);
  });
  body = body.replace(/`[^`\n]*`/g, (match) => {
    codeRegions.push(match);
    return codePlaceholder(codeRegions.length - 1);
  });

  // ── 1b. Pull markdown links out into their OWN sentinel placeholders, ──
  // BEFORE the HTML-escape and emphasis passes, so `*`/`_`/`~` inside a URL
  // can never be rewritten as `<i>`/`<b>`/`<s>` tags and spliced into the
  // href (which would produce malformed markup Chat may reject). The link
  // sentinel uses a DISTINCT prefix from the code placeholder
  // (`\x10LINK${i}\x10` vs `\x10CODE${i}\x10`) so the two restore passes can't
  // interfere. The final `<a href="…">…</a>` form is built NOW from the RAW
  // (pre-escape) text/url, HTML-escaping both so the URL never passes through
  // the emphasis transforms. We keep link text PLAIN (no emphasis) — the
  // simplest correct option. The URL group tolerates one level of balanced
  // `(...)` so links to pages whose path contains parens aren't truncated at
  // the first `)`. A disallowed scheme (javascript:, …) is NOT emitted as a
  // link — only the visible text is kept (and runs through the emphasis passes
  // as plain text), so a crafted link can't smuggle an href into the card.
  const linkRegions: string[] = [];
  const linkPlaceholder = (i: number) => `\x10LINK${i}\x10`;
  body = body.replace(
    /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g,
    (_m, t: string, u: string) => {
      if (!isSafeUrl(u)) return t; // keep raw text; let emphasis passes see it
      const href = escapeHtml(u).replace(/"/g, "&quot;");
      linkRegions.push(`<a href="${href}">${escapeHtml(t)}</a>`);
      return linkPlaceholder(linkRegions.length - 1);
    },
  );

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
  body = body.replace(/(^|[^*\w])\*(\S(?:[^*\n]*\S)?)\*(?!\w)/g, "$1<i>$2</i>");
  // Italic _text_ → <i>text</i>
  body = body.replace(/(^|[^_\w])_(\S(?:[^_\n]*\S)?)_(?!\w)/g, "$1<i>$2</i>");

  // (Markdown links were already extracted into sentinel placeholders in step
  // 1b, before the escape and emphasis passes, so their URLs never reach the
  // emphasis transforms and can't be corrupted.)

  // ── 4. Restore bold sentinels, links, and code regions, then newlines → <br>. ──
  body = body.replace(new RegExp(BOLD_OPEN, "g"), "<b>");
  body = body.replace(new RegExp(BOLD_CLOSE, "g"), "</b>");
  // Links restore to their pre-rendered `<a href="…">…</a>` form (built in
  // step 1b). The LINK and CODE placeholders use distinct prefixes so the two
  // restore passes never match each other's sentinels.
  body = body.replace(
    /\x10LINK(\d+)\x10/g,
    (_m, idx) => linkRegions[Number(idx)] ?? "",
  );
  body = body.replace(/\x10CODE(\d+)\x10/g, (_m, idx) =>
    escapeHtml(codeRegions[Number(idx)] ?? ""),
  );
  body = body.replace(/\r?\n/g, "<br>");

  return body;
}

/**
 * Convert markdown to the card HTML subset, THEN apply the length budget to
 * the FINAL HTML. Escaping/`<br>`/tag expansion can grow the string past the
 * limit, so budgeting the raw markdown (as we used to) could still emit HTML
 * that Chat rejects. Truncation here is HTML-safe (see {@link safeTruncateHtml}).
 */
function convertAndBudget(markdown: string, max: number): string {
  return safeTruncateHtml(markdownToCardHtml(markdown), max);
}

/**
 * Truncate an HTML string to at most `max` characters without producing
 * broken markup: never cut inside a `<…>` tag or an `&…;` entity, and close
 * (or drop) any tags left open by the cut. The common case is plain text well
 * under the limit, where this is a no-op; the repair only matters at the edge.
 */
function safeTruncateHtml(html: string, max: number): string {
  if (html.length <= max) return html;
  if (max <= 1) return html.slice(0, max);

  // Reserve one char for the ellipsis marker, matching truncateText.
  let cut = max - 1;

  // Back out of a partial tag: if the slice ends inside an unclosed `<…`,
  // cut before that `<`.
  const lastLt = html.lastIndexOf("<", cut - 1);
  const lastGt = html.lastIndexOf(">", cut - 1);
  if (lastLt > lastGt) cut = lastLt;

  // Back out of a partial entity: if the slice ends inside an unclosed `&…`,
  // cut before that `&`.
  const lastAmp = html.lastIndexOf("&", cut - 1);
  const lastSemi = html.lastIndexOf(";", cut - 1);
  if (lastAmp > lastSemi && lastAmp > lastLt) cut = lastAmp;

  let truncated = html.slice(0, cut);

  // Degenerate case: backing out of a mid-tag cut left no visible content
  // (e.g. the whole string is one over-long `<a href="…">…` link, and the cut
  // landed inside the opening tag). Returning just "…" would drop the text
  // entirely, so fall back to the escaped, length-bounded link/visible TEXT.
  if (truncated.length === 0) {
    const textOnly = html.replace(/<[^>]*>/g, "");
    const room = Math.max(0, max - 1);
    return escapeHtml(textOnly.slice(0, room)) + "…";
  }

  // Close any tags left open by the cut. We emit <b>/<i>/<s> and attributed
  // <a href="…"> anchors, so track all four; append closers (innermost first)
  // for the still-open ones. The anchor regex matches the attributed opening
  // tag (`<a …>`) as well as the closing `</a>`.
  const open: string[] = [];
  const tagRe = /<(\/?)(?:(b|i|s)|(a)\b[^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(truncated)) !== null) {
    const isClose = m[1] === "/";
    const tag = m[2] ?? m[3] ?? "";
    if (isClose) {
      const idx = open.lastIndexOf(tag);
      if (idx !== -1) open.splice(idx, 1);
    } else {
      open.push(tag);
    }
  }
  let closers = "";
  for (let i = open.length - 1; i >= 0; i--) closers += `</${open[i]}>`;

  // Ensure the closers + ellipsis still fit under `max`; if appending them
  // would overflow, trim more plain text from the end first.
  while (truncated.length + closers.length + 1 > max && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + closers + "…";
}

/** Options that change how actions are wired. */
export interface RenderOptions {
  /**
   * Add-on Chat apps route a click to a URL, so every action's `function` is
   * this endpoint URL. Legacy Chat apps take a function name; when this is
   * unset the minted action id is the function name.
   */
  endpointUrl?: string;
}

/** The expanded children of an IR node (empty if none). */
function childrenOf(node: ChannelNode): ChannelNode[] {
  const c = node.props?.children;
  if (Array.isArray(c)) return c as ChannelNode[];
  if (c && typeof c === "object" && "type" in (c as object))
    return [c as ChannelNode];
  return [];
}

/** Concatenate the text of all descendant `text` nodes (depth-first). */
function collectText(node: ChannelNode): string {
  if (typeof node.type === "string" && node.type === "text") {
    return String(node.props?.value ?? "");
  }
  return childrenOf(node).map(collectText).join(" ").trim();
}

/** True when the IR is a list of only plain text nodes — render as `{ text }` instead of a card. */
function isPlainText(ir: ChannelNode[]): boolean {
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

interface RenderState {
  opts: RenderOptions;
  /** Card-wide id for buttons without a handler, so their clicks stay distinct. */
  nextFallbackId: () => string;
}

type Param = { key: string; value: string };

/** A card `action` that routes a click back to this app with `params`. */
function cardAction(
  actionId: string,
  params: Param[],
  state: RenderState,
): Record<string, unknown> {
  return {
    function: state.opts.endpointUrl ?? actionId,
    parameters: [{ key: "actionId", value: actionId }, ...params],
  };
}

/** Render one `<Button>`, or undefined when it can do nothing. */
function renderButton(
  btn: ChannelNode,
  state: RenderState,
): Record<string, unknown> | undefined {
  const props = btn.props ?? {};
  const text = truncateText(collectText(btn) || " ", GCHAT_LIMITS.buttonText);
  if (typeof props.url === "string" && props.url.length > 0) {
    if (!isSafeUrl(props.url)) return undefined;
    return { text, onClick: { openLink: { url: props.url } } };
  }
  const actionId = idFromHandler(props.onClick) ?? state.nextFallbackId();
  // Omit `value` when there is none, so a value-less click decodes to
  // `undefined` rather than `""`.
  const params: Param[] =
    props.value !== undefined
      ? [{ key: "value", value: JSON.stringify(props.value) }]
      : [];
  const button: Record<string, unknown> = {
    text,
    onClick: { action: cardAction(actionId, params, state) },
  };
  if (props.style === "primary") button.type = "FILLED";
  if (props.style === "danger") {
    button.type = "FILLED";
    button.color = { red: 0.85, green: 0.19, blue: 0.15, alpha: 1 };
  }
  return button;
}

/** Render one `<Select>` as a dropdown that reports its choice on change. */
function renderSelect(
  node: ChannelNode,
  state: RenderState,
): Widget | undefined {
  const props = node.props ?? {};
  const actionId = idFromHandler(props.onSelect);
  if (!actionId) return undefined;
  const options =
    (props.options as { label: string; value: unknown }[] | undefined) ?? [];
  const { items, overflow } = clampArray(options, GCHAT_LIMITS.selectItems);
  if (overflow > 0) {
    console.warn(
      `[channels-google-chat] <Select> has more than ${GCHAT_LIMITS.selectItems} options; dropping ${overflow}.`,
    );
  }
  if (items.length === 0) return undefined;
  const multi = props.multi === true;
  return {
    selectionInput: {
      // The decoder reads the choice from the form input named after the action.
      name: actionId,
      ...(typeof props.placeholder === "string" && props.placeholder
        ? { label: truncateText(props.placeholder, GCHAT_LIMITS.headerText) }
        : {}),
      type: multi ? "MULTI_SELECT" : "DROPDOWN",
      items: items.map((o) => ({
        text: truncateText(o.label, GCHAT_LIMITS.buttonText * 2),
        value: String(o.value),
        selected: false,
      })),
      onChangeAction: cardAction(
        actionId,
        multi ? [{ key: "multi", value: "true" }] : [],
        state,
      ),
    },
  };
}

/** Render an `actions` node: buttons as one `buttonList`, each select as its own widget. */
function renderActionsWidgets(node: ChannelNode, state: RenderState): Widget[] {
  const widgets: Widget[] = [];
  let buttons: Record<string, unknown>[] = [];
  const flush = () => {
    if (buttons.length === 0) return;
    const { items, overflow } = clampArray(buttons, GCHAT_LIMITS.buttonsPerSet);
    if (overflow > 0) {
      console.warn(
        `[channels-google-chat] a button list exceeded ${GCHAT_LIMITS.buttonsPerSet} buttons; dropped ${overflow}.`,
      );
    }
    widgets.push({ buttonList: { buttons: items } });
    buttons = [];
  };
  for (const child of childrenOf(node)) {
    if (child.type === "button") {
      const b = renderButton(child, state);
      if (b) buttons.push(b);
    } else if (child.type === "select") {
      flush();
      const w = renderSelect(child, state);
      if (w) widgets.push(w);
    }
  }
  flush();
  return widgets;
}

/** A `<Table>` as an aligned monospace block (cards have no grid that fits). */
function tableToText(node: ChannelNode): string {
  const columns =
    (node.props?.columns as { header: string }[] | undefined) ?? [];
  const rows = childrenOf(node)
    .filter((r) => r.type === "row")
    .map((r) =>
      childrenOf(r)
        .filter((c) => c.type === "cell")
        .map((c) => collectText(c)),
    );
  const all =
    columns.length > 0 ? [columns.map((c) => c.header), ...rows] : rows;
  if (all.length === 0) return "";
  const width = Math.max(...all.map((r) => r.length));
  const sizes = Array.from({ length: width }, (_, i) =>
    Math.max(...all.map((r) => (r[i] ?? "").length)),
  );
  const line = (r: string[]) =>
    sizes
      .map((w, i) => (r[i] ?? "").padEnd(w))
      .join("  ")
      .trimEnd();
  const lines = all.map(line);
  if (columns.length > 0)
    lines.splice(1, 0, sizes.map((w) => "-".repeat(w)).join("  "));
  return lines.join("\n");
}

/** Render a single IR node into zero or more widgets. */
function renderNodeWidgets(node: ChannelNode, state: RenderState): Widget[] {
  if (typeof node.type !== "string") return [];
  const widgets: Widget[] = [];

  switch (node.type) {
    case "message": {
      for (const child of childrenOf(node)) {
        widgets.push(...renderNodeWidgets(child, state));
      }
      break;
    }
    case "header": {
      // The first header becomes the card header (see renderGoogleChatMessage).
      // Later headers render as a bold line.
      const html = convertAndBudget(
        `**${collectText(node)}**`,
        GCHAT_LIMITS.textParagraph,
      );
      if (html) widgets.push({ textParagraph: { text: html } });
      break;
    }
    case "section":
    case "markdown": {
      const textChildren = childrenOf(node).filter(
        (c) => c.type !== "actions" && c.type !== "button",
      );
      const html = convertAndBudget(
        textChildren.map(collectText).join(" ").trim(),
        GCHAT_LIMITS.textParagraph,
      );
      if (html) widgets.push({ textParagraph: { text: html } });
      for (const child of childrenOf(node)) {
        if (child.type === "actions")
          widgets.push(...renderActionsWidgets(child, state));
      }
      break;
    }
    case "actions": {
      widgets.push(...renderActionsWidgets(node, state));
      break;
    }
    case "divider": {
      widgets.push({ divider: {} });
      break;
    }
    case "image": {
      const props = node.props ?? {};
      const url = props.url as string | undefined;
      const alt = String(props.alt ?? "");
      // Chat rejects an image widget without a valid URL, which would fail
      // the whole message. The renderer is total: skip it.
      if (!url || !isAbsoluteHttpsUrl(url)) break;
      widgets.push({ image: { imageUrl: url, altText: alt } });
      break;
    }
    case "context": {
      const inner = convertAndBudget(
        collectText(node),
        GCHAT_LIMITS.textParagraph - "<i></i>".length,
      ).replace(/<\/?i>/g, "");
      if (inner) widgets.push({ textParagraph: { text: `<i>${inner}</i>` } });
      break;
    }
    case "fields": {
      for (const f of childrenOf(node).filter((c) => c.type === "field")) {
        widgets.push(...renderNodeWidgets(f, state));
      }
      break;
    }
    case "field": {
      const html = convertAndBudget(
        collectText(node),
        GCHAT_LIMITS.decoratedTextTop,
      );
      if (!html) break;
      const label = node.props?.label;
      widgets.push({
        decoratedText: {
          ...(typeof label === "string" && label
            ? { topLabel: truncateText(label, GCHAT_LIMITS.headerText) }
            : {}),
          text: html,
        },
      });
      break;
    }
    case "table": {
      const text = tableToText(node);
      if (text) {
        widgets.push({
          textParagraph: {
            text: safeTruncateHtml(
              `<font face="monospace">${escapeHtml(text).replace(/\n/g, "<br>")}</font>`,
              GCHAT_LIMITS.textParagraph,
            ),
          },
        });
      }
      break;
    }
    case "text": {
      const value = String((node.props ?? {}).value ?? "");
      if (value) {
        const html = convertAndBudget(value, GCHAT_LIMITS.textParagraph);
        if (html) widgets.push({ textParagraph: { text: html } });
      }
      break;
    }
    default:
      // Unknown or unsupported intrinsic (input, chart, carousel, …): skip.
      break;
  }

  return widgets;
}

/**
 * `<Message fallbackText>`, sent as the message `text`. Chat shows `text`
 * above the card, so the adapter sends it only when the author asked for it.
 */
function fallbackTextOf(nodes: ChannelNode[]): string {
  const root =
    nodes.length === 1 && nodes[0]?.type === "message" ? nodes[0] : undefined;
  const explicit = root?.props?.fallbackText;
  return typeof explicit === "string" ? explicit : "";
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
export function renderGoogleChatMessage(
  ir: ChannelNode[],
  opts: RenderOptions = {},
): {
  cardsV2?: unknown[];
  text?: string;
} {
  // Flatten a top-level <message> container.
  const nodes =
    ir.length === 1 && ir[0]?.type === "message" ? childrenOf(ir[0]) : ir;

  if (isPlainText(nodes)) {
    const plain = nodes.map(collectText).join("\n").trim();
    return { text: plain ? markdownToChat(plain) : " " };
  }

  const headerNode = nodes.find((n) => n.type === "header");
  const bodyNodes = nodes.filter((n) => n !== headerNode);

  let fallbackSeq = 0;
  const state: RenderState = {
    opts,
    nextFallbackId: () => `ck-fallback-${fallbackSeq++}`,
  };

  const widgets: Widget[] = bodyNodes.flatMap((n) =>
    renderNodeWidgets(n, state),
  );

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
        `[channels-google-chat] a card exceeded ${limit} widgets; ${hidden} not shown.`,
      );
    } else {
      clampedWidgets = widgets;
    }
  }

  // A section with `widgets: []` is rejected by the Chat API. With nothing to
  // show and no header, fall back to a plain text body.
  if (clampedWidgets.length === 0 && !headerNode) {
    return { text: " " };
  }

  const card: Record<string, unknown> = {};
  if (headerNode) {
    card.header = {
      title: truncateText(collectText(headerNode), GCHAT_LIMITS.headerText),
    };
  }
  if (clampedWidgets.length > 0) {
    card.sections = [{ widgets: clampedWidgets }];
  }

  const text = fallbackTextOf(ir);
  return {
    ...(text ? { text: truncateText(text, GCHAT_LIMITS.textParagraph) } : {}),
    cardsV2: [{ cardId: "ck-card", card }],
  };
}
