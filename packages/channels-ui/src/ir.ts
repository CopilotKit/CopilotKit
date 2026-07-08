export type ComponentFn = (
  props: Record<string, unknown>,
) => BotNode | BotNode[] | string | null;
export interface BotNode {
  type: string | ComponentFn | symbol;
  props: Record<string, unknown>;
  key?: string | number;
}
export type Renderable = string | BotNode | BotNode[] | { raw: unknown };
export const Fragment: unique symbol = Symbol.for("copilotkit.bot-ui.Fragment");
