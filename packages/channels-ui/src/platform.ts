import type { ChannelNode } from "./ir.js";
import type { ClickHandler } from "./types.js";

/** JSON values that can be carried in a platform-native UI node. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * The serializable portion of a platform-native UI element. Handlers and their
 * values deliberately remain top-level so the action registry can persist and
 * recover them independently of the provider payload.
 */
export interface PlatformNodeProps extends Record<string, unknown> {
  protocol: 1;
  platform: string;
  dialect: string;
  dialectVersion: string;
  element: string;
  attributes: JsonObject;
  children?: ChannelNode[];
  onSubmit?: ClickHandler;
  value?: unknown;
}

/** A reserved IR node for a platform-specific rendering dialect. */
export interface PlatformNode extends Omit<ChannelNode, "type" | "props"> {
  type: "$platform";
  props: PlatformNodeProps;
}

export interface PlatformNodeVisit {
  node: PlatformNode;
  path: readonly (string | number)[];
}

/** Create a platform-native node without exposing the reserved IR marker. */
export function platformNode(props: PlatformNodeProps): PlatformNode {
  return { type: "$platform", props };
}

/** True when a Channel IR node is a platform-specific node. */
export function isPlatformNode(node: ChannelNode): node is PlatformNode {
  return node.type === "$platform";
}

/** Find every platform-native node in a tree, preserving its user-visible path. */
export function findPlatformNodes(root: ChannelNode[]): PlatformNodeVisit[] {
  const found: PlatformNodeVisit[] = [];
  const visit = (nodes: ChannelNode[], base: (string | number)[]): void => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]!;
      const path = [...base, index];
      if (isPlatformNode(node)) found.push({ node, path });
      const children = node.props.children;
      if (Array.isArray(children)) {
        visit(children as ChannelNode[], [...path, "children"]);
      }
    }
  };
  visit(root, []);
  return found;
}

/** A native UI tree was posted through an adapter for a different platform. */
export class PlatformUiMismatchError extends Error {
  readonly actualPlatform: string;
  readonly expectedPlatform: string;
  readonly element: string;
  readonly path: readonly (string | number)[];

  constructor(args: {
    actualPlatform: string;
    expectedPlatform: string;
    element: string;
    path: readonly (string | number)[];
  }) {
    const path = formatPlatformPath(args.path);
    super(
      `Cannot render ${args.expectedPlatform}-native ${args.element} on ${args.actualPlatform} at ${path}. ` +
        `Post portable UI for ${args.actualPlatform}, or branch on thread.platform.`,
    );
    this.name = "PlatformUiMismatchError";
    this.actualPlatform = args.actualPlatform;
    this.expectedPlatform = args.expectedPlatform;
    this.element = args.element;
    this.path = args.path;
  }
}

/** A platform-native tree violates the shared IR contract. */
export class UnsupportedUiNodeError extends Error {
  readonly element: string;
  readonly path: readonly (string | number)[];

  constructor(args: {
    element: string;
    path: readonly (string | number)[];
    reason: string;
  }) {
    super(
      `Unsupported UI node ${args.element} at ${formatPlatformPath(args.path)}: ${args.reason}`,
    );
    this.name = "UnsupportedUiNodeError";
    this.element = args.element;
    this.path = args.path;
  }
}

/**
 * Validate shared invariants before an action handler is persisted. Adapters
 * can rely on this boundary to reject a native tree before any side effect,
 * rather than allowing their renderer to silently omit it.
 */
export function validatePlatformUi(
  root: ChannelNode[],
  actualPlatform: string,
): void {
  const nativeNodes = findPlatformNodes(root);
  if (nativeNodes.length === 0) return;

  const first = nativeNodes[0]!;
  if (root.length !== 1 || !isPlatformNode(root[0]!)) {
    throw new UnsupportedUiNodeError({
      element: first.node.props.element,
      path: first.path,
      reason:
        "portable and platform-native nodes cannot be mixed; a native post must have one native root",
    });
  }

  const expectedPlatform = first.node.props.platform;
  const dialect = first.node.props.dialect;
  const dialectVersion = first.node.props.dialectVersion;

  const visit = (nodes: ChannelNode[], base: (string | number)[]): void => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]!;
      const path = [...base, index];
      if (!isPlatformNode(node)) {
        throw new UnsupportedUiNodeError({
          element: String(node.type),
          path,
          reason: "portable and platform-native nodes cannot be mixed",
        });
      }
      const props = node.props;
      if (props.protocol !== 1) {
        throw new UnsupportedUiNodeError({
          element: props.element,
          path,
          reason: `platform UI protocol ${String(props.protocol)} is not supported`,
        });
      }
      if (props.platform !== expectedPlatform) {
        throw new UnsupportedUiNodeError({
          element: props.element,
          path,
          reason: `mixed platform tree (${expectedPlatform} and ${props.platform})`,
        });
      }
      if (
        props.dialect !== dialect ||
        props.dialectVersion !== dialectVersion
      ) {
        throw new UnsupportedUiNodeError({
          element: props.element,
          path,
          reason: `mixed dialect tree (${dialect}@${dialectVersion} and ${props.dialect}@${props.dialectVersion})`,
        });
      }
      const children = props.children;
      if (Array.isArray(children)) visit(children, [...path, "children"]);
    }
  };

  visit(root, []);

  if (expectedPlatform !== actualPlatform) {
    throw new PlatformUiMismatchError({
      actualPlatform,
      expectedPlatform,
      element: first.node.props.element,
      path: first.path,
    });
  }
}

export function formatPlatformPath(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (result, segment) =>
      typeof segment === "number"
        ? `${result}[${segment}]`
        : `${result}.${segment}`,
    "root",
  );
}
