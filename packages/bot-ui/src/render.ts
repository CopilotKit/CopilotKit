import { Fragment, type BotNode, type Renderable } from "./ir.js";

function isBotNode(v: unknown): v is BotNode {
  return typeof v === "object" && v !== null && "type" in v && "props" in v;
}

function expand(node: unknown): BotNode[] {
  if (node == null || node === false || node === true) return [];
  if (typeof node === "string" || typeof node === "number") {
    return [{ type: "text", props: { value: String(node) } }];
  }
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!isBotNode(node)) return [];
  if (node.type === Fragment) return expand(node.props.children);
  if (typeof node.type === "function") {
    return expand(
      (node.type as (p: Record<string, unknown>) => unknown)(node.props),
    );
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

export function renderToIR(ui: Renderable): BotNode[] {
  if (typeof ui === "object" && ui !== null && "raw" in ui) {
    return [{ type: "raw", props: { value: (ui as { raw: unknown }).raw } }];
  }
  return expand(ui);
}
