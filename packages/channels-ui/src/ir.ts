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
  | { raw: unknown };
export const Fragment: unique symbol = Symbol.for(
  "copilotkit.channels-ui.Fragment",
);
