import type { ClickHandler, InteractionContext } from "./types.js";
const BOUND = Symbol.for("copilotkit.channels-ui.bound");
interface BoundHandler {
  (...a: unknown[]): unknown;
  [BOUND]?: { handler: ClickHandler; args: unknown };
}
export function bind(handler: ClickHandler, args: unknown): ClickHandler {
  const wrapped = ((ctx: InteractionContext) =>
    handler({
      ...ctx,
      action: { ...ctx.action, value: args },
    })) as BoundHandler;
  wrapped[BOUND] = { handler, args };
  return wrapped as unknown as ClickHandler;
}
export function isBound(h: unknown): boolean {
  return typeof h === "function" && !!(h as BoundHandler)[BOUND];
}
export function getBoundArgs(h: unknown): unknown {
  return (h as BoundHandler)[BOUND]?.args;
}
export function getBoundHandler(h: unknown): ClickHandler | undefined {
  return (h as BoundHandler)[BOUND]?.handler;
}
