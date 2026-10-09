import { isHostElement } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";

/** React's runtime brand, without importing the optional peer. */
export function isReactElement(v: unknown): boolean {
  if (typeof v !== "object" || v === null || !("$$typeof" in v)) return false;
  return (
    v.$$typeof === Symbol.for("react.element") ||
    v.$$typeof === Symbol.for("react.transitional.element")
  );
}

/** Classify already-expanded IR so native components execute only once per operation. */
export function resolveArbitraryElement(
  nodes: readonly ChannelNode[],
): object | null {
  if (!nodes.some(isHostElement)) return null;
  if (nodes.some((node) => !isHostElement(node) && node.type !== "text")) {
    throw new Error(
      "Wrap image JSX in <Render> to mix it with native channel components.",
    );
  }
  return nodes.length === 1
    ? nodes[0]!
    : nodes.map((node) =>
        node.type === "text" && !isHostElement(node) ? node.props.value : node,
      );
}
