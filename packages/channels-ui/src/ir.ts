export type ComponentFn = (
  props: Record<string, unknown>,
) => ChannelNode | ChannelNode[] | string | null;
export interface ChannelNode {
  type: string | ComponentFn | symbol;
  props: Record<string, unknown>;
  key?: string | number;
}
export type Renderable =
  | string
  | ChannelNode
  | ChannelNode[]
  | { raw: unknown; provider?: "slack" | "teams" };
export const Fragment: unique symbol = Symbol.for(
  "copilotkit.channels-ui.Fragment",
);

/** Host markup is opaque to native rendering and action binding. */
export const HOST_ELEMENT: unique symbol = Symbol.for(
  "copilotkit.channels-ui.host",
);

export function isHostElement(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value))
    return false;
  if ((value as Record<symbol, unknown>)[HOST_ELEMENT] === true) return true;
  const tag = (value as { $$typeof?: unknown }).$$typeof;
  return (
    (tag === Symbol.for("react.element") ||
      tag === Symbol.for("react.transitional.element")) &&
    (typeof value.type === "string" || typeof value.type === "object")
  );
}
