import type { ChannelNode } from "@copilotkit/channels-ui";
import { NOTION_LIMITS, truncateText } from "./budget.js";
import {
  clampRichText,
  markdownToRichText,
  plainTextToRichText,
  richTextToPlainText,
} from "./rich-text.js";

/**
 * Action id for a value-only button: one with a `value` but no `onClick`.
 * There is no handler to dispatch, so the choice carries this id and the
 * button's value, and a numbered reply resolves the pending `awaitChoice`
 * with that value.
 */
export const NOTION_VALUE_ONLY_ACTION_ID = "notion:choice";

/** Text above the numbered choice list. */
export const NOTION_CHOICE_PROMPT = "Reply with a number:";

/** One numbered option in a rendered comment. A reply with `index` (or `label`) picks it. */
export interface RenderedChoice {
  /** 1-based number shown in the comment. */
  index: number;
  /** Option text shown after the number. */
  label: string;
  /** Minted action id the interaction is dispatched to. */
  actionId: string;
  /** Value echoed back to the handler or `awaitChoice` waiter. */
  value?: unknown;
}

/**
 * Lower `ChannelNode[]` IR to the `rich_text` of one Notion comment.
 *
 * Prose nodes become lines: `header` is a bold line, `section` and `markdown`
 * are converted from Markdown, `field` is `label: value` with a bold label,
 * `table` rows are `a | b`, `divider` is `---`, `context` is italic, and
 * `image` is a link. Other containers are walked for their children.
 *
 * Notion comments have no buttons. Every `button` and `select` option is
 * collected into one numbered list at the end ("Reply with a number:" then
 * `1. Label`), and returned as `choices` so a later numbered reply can be
 * decoded. When the comment is over budget, the prose is cut, never the list.
 *
 * @param ir - The IR that `thread.post` produced.
 * @returns `richText` for the comment API, its plain `text`, and the `choices`.
 */
export function renderNotionMessage(ir: ChannelNode[]) {
  const lines: string[] = [];
  const choices: RenderedChoice[] = [];
  // Adjacent text leaves (e.g. `Hello {name}`) join into one line.
  let inline = "";

  const flush = () => {
    if (inline) lines.push(inline);
    inline = "";
  };
  const pushLine = (line: string) => {
    flush();
    if (line) lines.push(line);
  };
  const addChoice = (label: string, actionId: string, value: unknown) => {
    choices.push({
      index: choices.length + 1,
      label,
      actionId,
      ...(value === undefined ? {} : { value }),
    });
  };

  const visitChildren = (children: unknown): void => {
    if (typeof children === "string") {
      inline += children;
      return;
    }
    if (typeof children === "number") {
      inline += String(children);
      return;
    }
    if (Array.isArray(children)) {
      for (const child of children) visitChildren(child);
      return;
    }
    if (isChannelNode(children)) visitNode(children);
  };

  const visitNode = (node: ChannelNode): void => {
    const type = typeof node.type === "string" ? node.type : "";
    const { props } = node;
    switch (type) {
      case "text": {
        const isPrintable =
          typeof props.value === "string" || typeof props.value === "number";
        if (isPrintable) inline += String(props.value);
        return;
      }
      case "header":
        pushLine(wrapLines(collectText(props.children), "**"));
        return;
      case "context":
        pushLine(wrapLines(collectText(props.children), "*"));
        return;
      case "field":
        pushLine(fieldLine(props));
        return;
      case "table":
        flush();
        lines.push(...tableLines(node));
        return;
      case "divider":
        pushLine("---");
        return;
      case "image":
        pushLine(imageLine(props));
        return;
      case "button": {
        const label = collectText(props.children);
        const url = props.url;
        if (typeof url === "string" && url) {
          pushLine(`[${label || url}](${url})`);
          return;
        }
        const handlerId = idFromHandler(props.onClick);
        if (handlerId) {
          addChoice(label, handlerId, props.value);
        } else if (props.value !== undefined) {
          addChoice(label, NOTION_VALUE_ONLY_ACTION_ID, props.value);
        }
        // A button with neither a handler nor a value cannot round-trip.
        return;
      }
      case "select": {
        const actionId = idFromHandler(props.onSelect);
        if (!actionId) return;
        const options = selectOptions(props.options);
        for (const option of options) {
          addChoice(option.label, actionId, option.value);
        }
        return;
      }
      default:
        // message/section/markdown/fields/actions/unknown: walk the children.
        flush();
        visitChildren(props.children);
        flush();
    }
  };

  for (const node of ir) visitNode(node);
  flush();

  const prose = lines.join("\n");
  const choiceText = choiceListText(choices, prose !== "");
  const proseBudget = Math.max(
    NOTION_LIMITS.commentText - choiceText.length,
    0,
  );
  const choiceItems = plainTextToRichText(choiceText);
  const proseItems = clampRichText(
    markdownToRichText(truncateText(prose, proseBudget)),
    NOTION_LIMITS.richTextItems - choiceItems.length,
  );
  const richText = clampRichText(
    [...proseItems, ...choiceItems],
    NOTION_LIMITS.richTextItems,
  );
  return { richText, text: richTextToPlainText(richText), choices };
}

function choiceListText(choices: RenderedChoice[], hasProse: boolean) {
  if (choices.length === 0) return "";
  const list = choices.map((choice) => `${choice.index}. ${choice.label}`);
  const block = [NOTION_CHOICE_PROMPT, ...list].join("\n");
  return hasProse ? `\n\n${block}` : block;
}

/** Wrap each non-blank line in a Markdown marker (`**` bold, `*` italic). */
function wrapLines(text: string, marker: string) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      return trimmed ? `${marker}${trimmed}${marker}` : "";
    })
    .join("\n");
}

function fieldLine(props: ChannelNode["props"]) {
  const value = collectText(props.children);
  const label = typeof props.label === "string" ? props.label : "";
  return label ? `**${label}:** ${value}` : value;
}

function imageLine(props: ChannelNode["props"]) {
  const url = typeof props.url === "string" ? props.url : "";
  if (!url) return "";
  const alt = typeof props.alt === "string" && props.alt ? props.alt : url;
  return `[${alt}](${url})`;
}

function tableLines(table: ChannelNode) {
  const columns = Array.isArray(table.props.columns) ? table.props.columns : [];
  const headers = columns.map((column) =>
    isRecord(column) && typeof column.header === "string" ? column.header : "",
  );
  const rows = childNodes(table.props.children)
    .filter((child) => child.type === "row")
    .map((row) =>
      childNodes(row.props.children)
        .map((cell) => collectText(cell.props.children))
        .join(" | "),
    );
  const headerLine = headers.some(Boolean)
    ? [`**${headers.join(" | ")}**`]
    : [];
  return [...headerLine, ...rows];
}

function selectOptions(options: unknown) {
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) =>
    isRecord(option) && typeof option.label === "string"
      ? [{ label: option.label, value: option.value }]
      : [],
  );
}

function childNodes(children: unknown): ChannelNode[] {
  if (Array.isArray(children)) return children.flatMap(childNodes);
  return isChannelNode(children) ? [children] : [];
}

function isChannelNode(value: unknown): value is ChannelNode {
  return isRecord(value) && "type" in value && isRecord(value.props);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extract the `{ id }` the action registry stamped onto an event prop. */
function idFromHandler(handler: unknown) {
  if (isRecord(handler) && typeof handler.id === "string") return handler.id;
  return undefined;
}

/**
 * Flatten a children tree to text. Handles plain strings and the
 * `{ type: "text", props: { value } }` leaves that `renderToIR` produces.
 */
function collectText(children: unknown): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(collectText).join("");
  if (!isChannelNode(children)) return "";
  const { value } = children.props;
  const isTextLeaf =
    children.type === "text" &&
    (typeof value === "string" || typeof value === "number");
  return isTextLeaf ? String(value) : collectText(children.props.children);
}
