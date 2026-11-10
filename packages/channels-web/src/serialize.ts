import { isHostElement } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { WebUiNode } from "./wire.js";

/** Props that hold a handler. Core replaces each bound handler with `{ id }`. */
const HANDLER_PROPS = new Set([
  "onClick",
  "onSelect",
  "onSubmit",
  "onReaction",
]);

/** Node types that only make sense on one provider. The browser cannot use them. */
const DROPPED_TYPES = new Set(["raw"]);

function isNodeLike(value: unknown): value is ChannelNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value
  );
}

/** The minted id of a bound handler prop, or `undefined` for an unbound one. */
function handlerId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/** Convert a value to plain JSON data. Returns `undefined` when JSON cannot hold it. */
function toJson(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "object") return undefined;
  if (isHostElement(value)) return undefined;
  if (isNodeLike(value)) return serializeNode(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (isNodeLike(item) && !isHostElement(item)) {
        const node = serializeNode(item);
        return node ? [node] : [];
      }
      const json = toJson(item);
      return json === undefined ? [] : [json];
    });
  }
  if (value instanceof Date) return value.toISOString();
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const json = toJson(entry);
    if (json !== undefined) out[key] = json;
  }
  return out;
}

function serializeNode(node: ChannelNode): WebUiNode | undefined {
  if (typeof node.type !== "string" || DROPPED_TYPES.has(node.type)) {
    return undefined;
  }
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.props ?? {})) {
    if (HANDLER_PROPS.has(name)) {
      const id = handlerId(value);
      if (id !== undefined) props[name] = id;
      continue;
    }
    // `<Render>` children are host React elements for an image snapshot. The
    // browser gets the `alt` summary instead.
    if (name === "children" && node.type === "render") continue;
    if (name === "children") {
      props.children = serializeIr(
        (Array.isArray(value) ? value : [value]) as ChannelNode[],
      );
      continue;
    }
    const json = toJson(value);
    if (json !== undefined) props[name] = json;
  }
  return {
    type: node.type,
    props,
    ...(node.key !== undefined ? { key: node.key } : {}),
  };
}

/**
 * Convert rendered channel IR to JSON the browser can render.
 *
 * Each bound handler prop (`onClick`, `onSelect`, `onSubmit`) becomes its
 * minted action id string. Functions, symbols, provider-native `raw` nodes,
 * and the host elements inside `<Render>` are removed.
 */
export function serializeIr(ir: readonly ChannelNode[]): WebUiNode[] {
  const out: WebUiNode[] = [];
  for (const node of ir) {
    if (!isNodeLike(node) || isHostElement(node)) continue;
    const serialized = serializeNode(node);
    if (serialized) out.push(serialized);
  }
  return out;
}

function childrenOf(node: ChannelNode): ChannelNode[] {
  const children = node.props?.children;
  if (children === undefined || children === null) return [];
  return (Array.isArray(children) ? children : [children]).filter(isNodeLike);
}

function inlineText(node: ChannelNode): string {
  if (node.type === "text") return String(node.props.value ?? "");
  return childrenOf(node).map(inlineText).join("");
}

function blockText(node: ChannelNode): string {
  switch (node.type) {
    case "text":
      return String(node.props.value ?? "");
    case "header":
    case "section":
    case "markdown":
    case "context":
      return inlineText(node);
    case "field": {
      const label =
        typeof node.props.label === "string" ? node.props.label : undefined;
      const value = inlineText(node);
      return label ? `${label}: ${value}` : value;
    }
    case "render":
      return typeof node.props.alt === "string" ? node.props.alt : "";
    case "table": {
      const columns = Array.isArray(node.props.columns)
        ? (node.props.columns as Array<{ header?: unknown }>)
            .map((c) => String(c.header ?? ""))
            .join(" | ")
        : "";
      const rows = childrenOf(node).map((row) =>
        childrenOf(row).map(inlineText).join(" | "),
      );
      return [columns, ...rows].filter(Boolean).join("\n");
    }
    case "actions":
    case "button":
    case "select":
    case "input":
    case "divider":
    case "image":
    case "raw":
      return "";
    default:
      return childrenOf(node)
        .map(blockText)
        .filter((text) => text.length > 0)
        .join("\n");
  }
}

/**
 * Plain text for a UI message. Clients that do not render `channels.ui`
 * events show this text, and it becomes the assistant message the agent sees
 * in later turns. A root `<Message fallbackText>` wins over derived text.
 */
export function irToText(ir: readonly ChannelNode[]): string {
  const blocks: string[] = [];
  for (const node of ir) {
    if (!isNodeLike(node)) continue;
    if (
      node.type === "message" &&
      typeof node.props.fallbackText === "string" &&
      node.props.fallbackText.length > 0
    ) {
      blocks.push(node.props.fallbackText);
      continue;
    }
    const text = blockText(node);
    if (text.length > 0) blocks.push(text);
  }
  return blocks.join("\n");
}
