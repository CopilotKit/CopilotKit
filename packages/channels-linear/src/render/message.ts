import type { ChannelNode } from "@copilotkit/channels-ui";
import type {
  ElicitationActivityContent,
  ResponseActivityContent,
  SelectSignalMetadata,
} from "../types.js";
import { LINEAR_LIMITS, truncateText } from "./budget.js";

/**
 * Synthetic action id for a value-only button (one with a `value` but no
 * `onClick`, for example an `awaitChoice` confirm and cancel pair posted
 * without handlers). There is no handler to dispatch, so the pick resolves
 * the waiting choice with the button's `value` under this id.
 */
export const LINEAR_VALUE_ONLY_ID = "linear:choice";

/** Body of an elicitation whose IR has controls but no text. */
const DEFAULT_ELICITATION_BODY = "Choose an option.";

/**
 * One selectable option of a rendered elicitation. A pick comes back from
 * Linear as a `prompt` activity whose body is `optionValue`; ingress maps it
 * back to `actionId` and `value`.
 */
export interface RenderedChoice {
  /** The control's own label (button text or select option label). */
  label: string;
  /** The `select` option value Linear shows and echoes back. Unique per message. */
  optionValue: string;
  /** The handler id the pick dispatches to, or {@link LINEAR_VALUE_ONLY_ID}. */
  actionId: string;
  /** The value the pick resolves with (button `value`, select option value). */
  value?: unknown;
}

/** A control collected during the IR walk, before option values are assigned. */
type CollectedChoice = Omit<RenderedChoice, "optionValue">;

/**
 * Lower channel IR to one Linear agent activity.
 *
 * The IR becomes a Markdown body. Without controls the activity is a
 * `response`. With any button or select it is an `elicitation` with the
 * `select` signal: each control becomes one option in `signalMetadata`, and
 * `choices` maps each option back to its action id and value.
 *
 * @param ir - The rendered `ChannelNode[]` tree of one message.
 * @example
 * const { content, signal, signalMetadata, choices } = renderLinearMessage(ir);
 * await client.createActivity(sessionId, content, { signal, signalMetadata });
 */
export function renderLinearMessage(ir: ChannelNode[]) {
  const collected: CollectedChoice[] = [];
  const markdown = renderChildren(ir, collected);

  if (collected.length === 0) {
    const content: ResponseActivityContent = {
      type: "response",
      body: truncateText(markdown, LINEAR_LIMITS.activityBody),
    };
    const choices: RenderedChoice[] = [];
    return { content, choices };
  }

  const choices = assignOptionValues(collected);
  const content: ElicitationActivityContent = {
    type: "elicitation",
    body: truncateText(
      markdown || DEFAULT_ELICITATION_BODY,
      LINEAR_LIMITS.activityBody,
    ),
  };
  const signalMetadata: SelectSignalMetadata = {
    options: choices.map((choice) => ({ value: choice.optionValue })),
  };
  const signal = "select" as const;
  return { content, signal, signalMetadata, choices };
}

/**
 * Give every choice a unique option value. Linear echoes only the picked
 * option's value, so two equal labels would be ambiguous: the second gets a
 * ` (2)` suffix, the third ` (3)`, and so on.
 */
function assignOptionValues(collected: CollectedChoice[]) {
  const taken = new Set<string>();
  return collected.map((choice, index) => {
    const label = choice.label.trim() || `Option ${index + 1}`;
    const optionValue = uniqueOptionValue(label, taken);
    taken.add(optionValue);
    return { ...choice, optionValue };
  });
}

function uniqueOptionValue(label: string, taken: ReadonlySet<string>) {
  const base = truncateText(label, LINEAR_LIMITS.optionValue);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate =
      truncateText(label, LINEAR_LIMITS.optionValue - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Render a `children` value to Markdown blocks. Adjacent inline text (strings,
 * numbers, `text` leaves) joins into one block; every other node is its own
 * block, separated by a blank line.
 */
function renderChildren(children: unknown, choices: CollectedChoice[]) {
  const blocks: string[] = [];
  let inline = "";
  const flushInline = () => {
    if (inline.trim()) blocks.push(inline.trim());
    inline = "";
  };
  const items = Array.isArray(children) ? children.flat(Infinity) : [children];
  for (const item of items) {
    if (typeof item === "string" || typeof item === "number") {
      inline += String(item);
      continue;
    }
    if (!isNode(item)) continue;
    if (item.type === "text") {
      inline += textLeafValue(item);
      continue;
    }
    flushInline();
    const block = renderNode(item, choices);
    if (block) blocks.push(block);
  }
  flushInline();
  return blocks.join("\n\n");
}

// Annotated: renderNode and renderChildren recurse into each other, and
// TypeScript cannot infer a return type through that cycle.
function renderNode(node: ChannelNode, choices: CollectedChoice[]): string {
  // Components are expanded before render; a Fragment or other non-string
  // node only groups its children.
  if (typeof node.type !== "string") {
    return renderChildren(node.props.children, choices);
  }
  switch (node.type) {
    case "text":
      return textLeafValue(node);
    case "header":
      return `### ${collectText(node.props.children)}`;
    case "field":
      return renderField(node);
    case "fields":
      // One field per line, no blank line between them.
      return childNodes(node)
        .map((child) => renderNode(child, choices))
        .filter(Boolean)
        .join("\n");
    case "context":
      return collectText(node.props.children)
        .split("\n")
        .map((line) => (line.trim() ? `_${line.trim()}_` : line))
        .join("\n");
    case "divider":
      return "---";
    case "image":
      return renderImage(node);
    case "table":
      return renderTable(node);
    case "button":
      return collectButton(node, choices);
    case "select":
      collectSelect(node, choices);
      return "";
    default:
      // Containers (message, section, markdown, actions, ...) and unknown
      // nodes: render their children.
      return renderChildren(node.props.children, choices);
  }
}

function renderField(node: ChannelNode) {
  const value = collectText(node.props.children);
  const label = node.props.label;
  if (typeof label === "string" && label) return `**${label}:** ${value}`;
  return value;
}

function renderImage(node: ChannelNode) {
  const url = node.props.url;
  if (typeof url !== "string" || !url) return "";
  const alt = typeof node.props.alt === "string" ? node.props.alt : "";
  return `![${alt}](${url})`;
}

/**
 * Collect a button as a choice. A link button renders as a Markdown link and
 * is not a choice. A button with neither a handler nor a value cannot
 * round-trip, so it is skipped.
 */
function collectButton(node: ChannelNode, choices: CollectedChoice[]) {
  const label = collectText(node.props.children);
  const url = node.props.url;
  if (typeof url === "string" && url) return `[${label || url}](${url})`;
  const value = node.props.value;
  const handlerId = idFromHandler(node.props.onClick);
  if (handlerId) {
    choices.push({ label, actionId: handlerId, value });
    return "";
  }
  if (value !== undefined) {
    choices.push({ label, actionId: LINEAR_VALUE_ONLY_ID, value });
  }
  return "";
}

/**
 * Collect each select option as a choice. Linear's `select` signal picks one
 * option, so a `multi` select degrades to single choice and resolves with a
 * one-item array.
 */
function collectSelect(node: ChannelNode, choices: CollectedChoice[]) {
  const actionId = idFromHandler(node.props.onSelect);
  if (!actionId) return;
  const isMulti = node.props.multi === true;
  const options = Array.isArray(node.props.options) ? node.props.options : [];
  for (const option of options) {
    if (!isSelectOption(option)) continue;
    choices.push({
      label: option.label,
      actionId,
      value: isMulti ? [option.value] : option.value,
    });
  }
}

/** GFM table for `<Table>`, with a header row from `columns` when given. */
function renderTable(node: ChannelNode) {
  const columns = Array.isArray(node.props.columns)
    ? node.props.columns.filter(isTableColumn)
    : [];
  const rows = childNodes(node)
    .filter((row) => row.type === "row")
    .map((row) =>
      childNodes(row)
        .filter((cell) => cell.type === "cell")
        .map((cell) => collectText(cell.props.children).replace(/\|/g, "\\|")),
    );
  const width = Math.max(columns.length, ...rows.map((row) => row.length), 0);
  if (width === 0) return "";

  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  const headers = Array.from(
    { length: width },
    (_, i) => columns[i]?.header ?? " ",
  );
  const separators = Array.from({ length: width }, (_, i) => {
    const align = columns[i]?.align;
    if (align === "center") return ":---:";
    if (align === "right") return "---:";
    return "---";
  });
  return [
    line(headers),
    `| ${separators.join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

function isNode(value: unknown): value is ChannelNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value &&
    typeof value.props === "object" &&
    value.props !== null
  );
}

function isSelectOption(
  value: unknown,
): value is { label: string; value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    "value" in value &&
    typeof value.label === "string" &&
    typeof value.value === "string"
  );
}

function isTableColumn(
  value: unknown,
): value is { header: string; align?: "left" | "center" | "right" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "header" in value &&
    typeof value.header === "string"
  );
}

/** The child nodes of a node, skipping plain strings and empty slots. */
function childNodes(node: ChannelNode) {
  const children = node.props.children;
  const items = Array.isArray(children) ? children.flat(Infinity) : [children];
  return items.filter(isNode);
}

function textLeafValue(node: ChannelNode) {
  const value = node.props.value;
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

/** Extract the `{ id }` the action registry stamped onto an event prop. */
function idFromHandler(handler: unknown) {
  if (typeof handler !== "object" || handler === null) return undefined;
  if (!("id" in handler) || typeof handler.id !== "string") return undefined;
  return handler.id;
}

/** Flatten a `children` value to plain text (strings, numbers, `text` leaves). */
function collectText(children: unknown): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(collectText).join("");
  if (!isNode(children)) return "";
  if (children.type === "text") return textLeafValue(children);
  return collectText(children.props.children);
}
