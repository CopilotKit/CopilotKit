import { Fragment } from "./ir.js";
import type { ChannelNode, Renderable } from "./ir.js";
import { isNativeNode } from "./native.js";

function isChannelNode(v: unknown): v is ChannelNode {
  return typeof v === "object" && v !== null && "type" in v && "props" in v;
}

function expand(node: unknown): ChannelNode[] {
  if (node == null || node === false || node === true) return [];
  if (typeof node === "string" || typeof node === "number") {
    return [{ type: "text", props: { value: String(node) } }];
  }
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!isChannelNode(node)) return [];
  if (node.type === Fragment) return expand(node.props.children);
  if (typeof node.type === "function") {
    const expanded = expand(
      (node.type as (p: Record<string, unknown>) => unknown)(node.props),
    );
    if (node.key !== undefined && expanded.length === 1 && expanded[0]) {
      expanded[0] = { ...expanded[0], key: expanded[0].key ?? node.key };
    }
    return expanded;
  }
  if (isNativeNode(node)) {
    return [
      {
        ...node,
        props: Object.fromEntries(
          Object.entries(node.props).map(([name, value]) => [
            name,
            expandNativeValue(value),
          ]),
        ),
      },
    ];
  }
  const { children, ...rest } = node.props;
  const expandedChildren =
    children === undefined ? undefined : expand(children);
  return [
    {
      type: node.type,
      props:
        expandedChildren === undefined
          ? rest
          : { ...rest, children: expandedChildren },
      key: node.key,
    },
  ];
}

/** Expand JSX-valued native slots while leaving scalar native objects intact. */
function expandNativeValue(value: unknown): unknown {
  if (isChannelNode(value)) {
    const expanded = expand(value);
    return expanded.length === 1 ? expanded[0] : expanded;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!isChannelNode(item)) return [item];
      return expand(item);
    });
  }
  return value;
}

export function renderToIR(ui: Renderable): ChannelNode[] {
  if (typeof ui === "object" && ui !== null && "raw" in ui) {
    const native = ui as {
      raw: unknown;
      provider?: "slack" | "teams" | "discord";
    };
    return [
      {
        type: "raw",
        props: { value: native.raw, provider: native.provider ?? "slack" },
      },
    ];
  }
  return expand(ui);
}
