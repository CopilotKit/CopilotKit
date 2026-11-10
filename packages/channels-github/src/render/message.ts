import type {
  ChannelNode,
  SelectOption,
  TableColumn,
} from "@copilotkit/channels-ui";
import { GITHUB_LIMITS, truncateText } from "./budget.js";

/**
 * One numbered option in a rendered comment. A reply with `index` (or the
 * exact `label`) answers it: the adapter turns the reply into an interaction
 * that carries `actionId` and `value`.
 */
export interface RenderedChoice {
  /** 1-based number shown in the comment. */
  index: number;
  /** Option text shown after the number. */
  label: string;
  /** Minted action id of the control, or {@link VALUE_ONLY_CHOICE_ID}. */
  actionId: string;
  /** Value the control answers with (button `value` or select option `value`). */
  value?: unknown;
}

/**
 * Action id for a control that has a value but no handler id (for example a
 * value-only `<Button value="yes">`). There is no handler to dispatch, but the
 * value must round-trip so an `awaitChoice` waiter resolves with it.
 */
export const VALUE_ONLY_CHOICE_ID = "github:choice";

/** Line that introduces the numbered choice list. */
export const CHOICE_PROMPT = "Reply with a number:";

/**
 * Lower channel IR to a GitHub-flavored Markdown comment body.
 *
 * Headers become `###` headings, fields a bullet list, tables GFM tables,
 * dividers `---`, context `<sub>` text, and images `![alt](url)`. Buttons and
 * select options become one numbered list at the end of the body, introduced
 * by {@link CHOICE_PROMPT}. Each list entry is returned in `choices` so the
 * adapter can map a numbered reply back to the control.
 *
 * The body fits in `GITHUB_LIMITS.commentBody`. When it is too long, the prose
 * is truncated and the choice list is kept whole.
 *
 * @param ir - The IR from `renderToIR`, after the action registry stamped handler ids.
 */
export function renderGitHubMessage(ir: ChannelNode[]) {
  const choices: RenderedChoice[] = [];
  const prose = renderBlocks(ir, choices).trim();
  const limit = GITHUB_LIMITS.commentBody;

  if (choices.length === 0) {
    return { body: truncateText(prose, limit), choices };
  }

  const menu = [
    CHOICE_PROMPT,
    "",
    ...choices.map((choice) => `${choice.index}. ${choice.label}`),
  ].join("\n");
  const proseBudget = limit - menu.length - 2;
  if (prose === "" || proseBudget <= 0) {
    return { body: truncateText(menu, limit), choices };
  }
  return {
    body: `${truncateText(prose, proseBudget)}\n\n${menu}`,
    choices,
  };
}

/**
 * Render a children list as Markdown blocks separated by blank lines.
 * Adjacent text leaves stay in one paragraph (`Hello {name}` lowers to two
 * text leaves).
 */
function renderBlocks(children: unknown, choices: RenderedChoice[]) {
  const blocks: string[] = [];
  let inline = "";
  const flushInline = () => {
    if (inline.trim() !== "") blocks.push(inline);
    inline = "";
  };

  const items = toList(children);
  for (const item of items) {
    if (typeof item === "string" || typeof item === "number") {
      inline += String(item);
      continue;
    }
    if (!isChannelNode(item)) continue;
    if (item.type === "text") {
      inline += textValue(item);
      continue;
    }
    flushInline();
    const block = renderNode(item, choices);
    if (block !== "") blocks.push(block);
  }
  flushInline();
  return blocks.join("\n\n");
}

function renderNode(node: ChannelNode, choices: RenderedChoice[]): string {
  switch (node.type) {
    case "text":
      return textValue(node);
    case "header": {
      const text = inlineText(node.props.children);
      return text === "" ? "" : `### ${text}`;
    }
    case "fields":
      return childNodes(node)
        .filter((child) => child.type === "field")
        .map((field) => `- ${renderField(field)}`)
        .join("\n");
    case "field":
      return renderField(node);
    case "table":
      return renderTable(node);
    case "divider":
      return "---";
    case "context": {
      const text = inlineText(node.props.children);
      return text === "" ? "" : `<sub>${text}</sub>`;
    }
    case "image":
      return renderImage(node);
    case "render":
      // A `<Render>` snapshot the host did not turn into an image: keep its summary.
      return typeof node.props.alt === "string" ? node.props.alt : "";
    case "button":
      return renderButton(node, choices);
    case "select":
      addSelectChoices(node, choices);
      return "";
    case "input":
    case "raw":
      // No free-text input control and no provider-native payload on GitHub.
      return "";
    default:
      // message / section / markdown / actions / carousel and unknown nodes.
      return renderBlocks(node.props.children, choices);
  }
}

function renderField(field: ChannelNode) {
  const value = inlineText(field.props.children);
  const label = field.props.label;
  return typeof label === "string" && label !== ""
    ? `**${label}:** ${value}`
    : value;
}

function renderImage(node: ChannelNode) {
  const url = node.props.url;
  if (typeof url !== "string" || url === "") return "";
  const alt = typeof node.props.alt === "string" ? node.props.alt : "";
  return `![${alt.replace(/[[\]]/g, "\\$&")}](${url})`;
}

function renderButton(node: ChannelNode, choices: RenderedChoice[]) {
  const label = inlineText(node.props.children);
  const url = node.props.url;
  if (typeof url === "string" && url !== "") {
    // A link button opens a URL; render it as a Markdown link.
    return `[${label === "" ? url : label}](${url})`;
  }
  const value = node.props.value;
  const handlerId = idFromHandler(node.props.onClick);
  if (handlerId !== undefined) {
    addChoice(choices, label, handlerId, value);
  } else if (value !== undefined) {
    addChoice(choices, label, VALUE_ONLY_CHOICE_ID, value);
  }
  // A button with neither a handler nor a value cannot answer anything: skip it.
  return "";
}

function addSelectChoices(node: ChannelNode, choices: RenderedChoice[]) {
  const actionId = idFromHandler(node.props.onSelect) ?? VALUE_ONLY_CHOICE_ID;
  const rawOptions = node.props.options;
  const options = Array.isArray(rawOptions)
    ? rawOptions.filter(isSelectOption)
    : [];
  for (const option of options) {
    addChoice(choices, option.label, actionId, option.value);
  }
}

function addChoice(
  choices: RenderedChoice[],
  label: string,
  actionId: string,
  value: unknown,
) {
  choices.push({ index: choices.length + 1, label, actionId, value });
}

function renderTable(node: ChannelNode) {
  const rawColumns = node.props.columns;
  const columns = Array.isArray(rawColumns)
    ? rawColumns.filter(isTableColumn)
    : [];
  const rows = childNodes(node)
    .filter((child) => child.type === "row")
    .map((row) =>
      childNodes(row)
        .filter((child) => child.type === "cell")
        .map((cell) => tableCell(cell.props.children)),
    );
  const width = Math.max(columns.length, ...rows.map((row) => row.length));
  if (width === 0) return "";

  const indexes = Array.from({ length: width }, (_, i) => i);
  const line = (cells: string[]) =>
    `| ${indexes.map((i) => cells[i] ?? "").join(" | ")} |`;
  const header = indexes.map((i) => tableCell(columns[i]?.header ?? ""));
  const separator = indexes.map((i) => alignmentMarker(columns[i]?.align));
  return [line(header), line(separator), ...rows.map(line)].join("\n");
}

function alignmentMarker(align: TableColumn["align"]) {
  switch (align) {
    case "center":
      return ":---:";
    case "right":
      return "---:";
    case "left":
    case undefined:
      return "---";
  }
}

/** Cell text with pipes escaped and line breaks kept inside the row. */
function tableCell(children: unknown) {
  return textOf(children)
    .trim()
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

/** Text of a subtree on one line: newlines and the space around them become one space. */
function inlineText(children: unknown) {
  return textOf(children)
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** Concatenated text of a subtree (text leaves and plain string/number children). */
function textOf(children: unknown): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (!isChannelNode(children)) return "";
  if (children.type === "text") return textValue(children);
  return textOf(children.props.children);
}

function textValue(node: ChannelNode) {
  const value = node.props.value;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function childNodes(node: ChannelNode) {
  return toList(node.props.children).filter(isChannelNode);
}

function toList(children: unknown): unknown[] {
  if (Array.isArray(children)) return children;
  if (children === undefined || children === null) return [];
  return [children];
}

/** The `{ id }` the action registry stamped onto an event prop, if present. */
function idFromHandler(handler: unknown) {
  if (typeof handler !== "object" || handler === null || !("id" in handler)) {
    return undefined;
  }
  return typeof handler.id === "string" ? handler.id : undefined;
}

function isChannelNode(value: unknown): value is ChannelNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value &&
    typeof value.props === "object" &&
    value.props !== null
  );
}

function isSelectOption(value: unknown): value is SelectOption {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string" &&
    "value" in value &&
    typeof value.value === "string"
  );
}

function isTableColumn(value: unknown): value is TableColumn {
  return (
    typeof value === "object" &&
    value !== null &&
    "header" in value &&
    typeof value.header === "string"
  );
}
