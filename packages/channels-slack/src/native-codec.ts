import { isNativeNode } from "@copilotkit/channels-ui";
import type { ChannelNode, NativeChannelNode } from "@copilotkit/channels-ui";
import { SLACK_NATIVE_MANIFEST } from "./native-manifest.js";

const manifest = new Map(
  SLACK_NATIVE_MANIFEST.map((entry) => [`${entry.kind}:${entry.type}`, entry]),
);
const HANDLERS = new Set(["onClick", "onSelect", "onSubmit"]);
const REQUIRED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  actions: ["elements"],
  button: ["text"],
  context: ["elements"],
  header: ["text"],
  image: ["image_url", "alt_text"],
  input: ["label", "element"],
  option: ["text", "value"],
  video: ["alt_text", "thumbnail_url", "title", "title_url", "video_url"],
};

/** Serialize and validate one traversable Slack native node. */
export function serializeSlackNativeNode(
  node: NativeChannelNode,
  path = "Slack",
): Record<string, unknown> {
  if (node.props.provider !== "slack") {
    throw new Error(`${path}: Slack delivery cannot render Teams native JSX.`);
  }
  if (node.props.nativeKind === "raw") {
    assertRawIsNonInteractive(node.props.value, `${path}.Raw`);
    if (!isRecord(node.props.value)) {
      throw new Error(`${path}.Raw: value must be a Slack object.`);
    }
    return node.props.value;
  }
  const entry = manifest.get(
    `${node.props.nativeKind}:${node.props.nativeType}`,
  );
  if (!entry) {
    throw new Error(
      `${path}: unknown Slack ${node.props.nativeKind} ${node.props.nativeType}.`,
    );
  }

  const output: Record<string, unknown> = { type: entry.type };
  for (const [name, value] of Object.entries(node.props)) {
    if (
      name === "provider" ||
      name === "nativeKind" ||
      name === "nativeType" ||
      HANDLERS.has(name)
    ) {
      continue;
    }
    if (name === "children") {
      if (value !== undefined && !entry.childrenSlot) {
        throw new Error(
          `${path}.${entry.component}: children are not allowed.`,
        );
      }
      if (entry.childrenSlot) {
        output[entry.childrenSlot] = serializeValue(
          value,
          `${path}.${entry.component}.${entry.childrenSlot}`,
        );
      }
      continue;
    }
    output[name] = serializeValue(value, `${path}.${entry.component}.${name}`);
  }

  const handler = handlerOf(node.props);
  if (handler) output.action_id = handler.id;
  if (output.value !== undefined && typeof output.value !== "string") {
    output.value = JSON.stringify(output.value);
  }
  validateRequiredFields(entry.component, entry.type, output, path);
  return output;
}

function validateRequiredFields(
  component: string,
  type: string,
  output: Record<string, unknown>,
  path: string,
): void {
  for (const field of REQUIRED_FIELDS[type] ?? []) {
    if (output[field] === undefined) {
      throw new Error(`${path}.${component}.${field} is required.`);
    }
  }
  if (
    type === "section" &&
    output.text === undefined &&
    output.fields === undefined
  ) {
    throw new Error(`${path}.${component} requires text or fields.`);
  }
}

/** Read useful plain text from native nodes for Slack notifications and a11y. */
export function slackNativeText(node: NativeChannelNode): string {
  for (const field of [
    node.props.text,
    node.props.title,
    node.props.alt_text,
  ]) {
    const direct = textValue(field);
    if (direct) return direct;
  }
  const pieces: string[] = [];
  visit(node.props, (name, value) => {
    if (
      (name === "text" || name === "title" || name === "alt_text") &&
      typeof value === "string"
    ) {
      pieces.push(value.replaceAll("*", ""));
    }
  });
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

/** Derive the same short Slack fallback for direct and managed delivery. */
export function slackFallbackText(ir: readonly ChannelNode[]): string {
  const rootFallback = ir.find(
    (node) =>
      node.type === "message" && typeof node.props.fallbackText === "string",
  )?.props.fallbackText;
  if (typeof rootFallback === "string" && rootFallback.trim()) {
    return truncateFallback(rootFallback);
  }
  const header = findPortableNode(ir, "header");
  const source = header ? portableText(header) : firstTreeText(ir);
  return truncateFallback(source || "…");
}

function truncateFallback(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "…";
  return text.length > 150 ? `${text.slice(0, 149)}…` : text;
}

function firstTreeText(nodes: readonly ChannelNode[]): string {
  for (const node of nodes) {
    const text = isNativeNode(node)
      ? slackNativeText(node)
      : portableText(node);
    if (text.trim()) return text;
  }
  return "";
}

function portableText(node: ChannelNode): string {
  if (node.type === "text") return String(node.props.value ?? "");
  const children = channelChildren(node.props.children);
  return children.map(portableText).filter(Boolean).join(" ");
}

function findPortableNode(
  nodes: readonly ChannelNode[],
  type: string,
): ChannelNode | undefined {
  for (const node of nodes) {
    if (node.type === type) return node;
    const found = findPortableNode(channelChildren(node.props.children), type);
    if (found) return found;
  }
  return undefined;
}

function channelChildren(value: unknown): ChannelNode[] {
  if (Array.isArray(value)) return value.filter(isChannelNode);
  return isChannelNode(value) ? [value] : [];
}

function isChannelNode(value: unknown): value is ChannelNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value
  );
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.replaceAll("*", "").trim();
  if (isNativeNode(value)) return slackNativeText(value);
  return "";
}

function serializeValue(value: unknown, path: string): unknown {
  if (isNativeNode(value)) return serializeSlackNativeNode(value, path);
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      serializeValue(item, `${path}[${index}]`),
    );
  }
  return value;
}

function handlerOf(props: Record<string, unknown>): BoundHandler | undefined {
  for (const name of HANDLERS) {
    const handler = props[name];
    if (
      isRecord(handler) &&
      typeof handler.id === "string" &&
      handler.id.length > 0
    ) {
      return { id: handler.id };
    }
  }
  return undefined;
}

interface BoundHandler {
  readonly id: string;
}

function assertRawIsNonInteractive(value: unknown, path: string): void {
  visit(value, (name, current) => {
    if (HANDLERS.has(name) || typeof current === "function") {
      throw new Error(`${path}: raw payloads cannot contain SDK callbacks.`);
    }
  });
}

function visit(
  value: unknown,
  visitor: (name: string, value: unknown) => void,
): void {
  if (Array.isArray(value)) {
    for (const child of value) visit(child, visitor);
    return;
  }
  if (!isRecord(value)) return;
  for (const [name, child] of Object.entries(value)) {
    visitor(name, child);
    visit(child, visitor);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
