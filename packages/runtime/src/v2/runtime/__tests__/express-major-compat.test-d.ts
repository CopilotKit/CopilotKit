/**
 * Type-level regression for #7276.
 *
 * `CopilotExpressRouter` used to be `Router & { channels? }`, with `Router`
 * coming from the runtime's own Express 4 types. An Express 5 app could not
 * mount it — `app.use(copilotRouter)` failed to compile in the consumer's
 * project, because a v4-typed router is not assignable to a v5 `use()`.
 *
 * The fix widened the exported type to the structural middleware shape both
 * majors accept. These assertions pin that widening so a later edit cannot
 * quietly re-introduce an Express-derived type.
 *
 * Note on what this file can and cannot prove. The real failure only reproduces
 * in a consumer project compiled with `strict: true`; this package sets
 * `strict: false`, so a plain assignability assertion here passes under both the
 * broken and the fixed type and would be worthless. The `keyof` assertions below
 * are strictness-independent: they fail the moment the type carries Express
 * router members again. The end-to-end proof is a consumer compile against real
 * `@types/express@5`, recorded on #7276.
 *
 * Checked by the package `check-types` target, whose tsconfig includes this
 * directory. Nothing runs at runtime.
 */
import type { CopilotExpressRouter } from "../endpoints/express";
import type { ChannelsControl } from "../core/channel-manager";

/** Express's `Router` has these; our exported type must not. */
type HasExpressRouterMember = "get" extends keyof CopilotExpressRouter
  ? true
  : "post" extends keyof CopilotExpressRouter
    ? true
    : "param" extends keyof CopilotExpressRouter
      ? true
      : "use" extends keyof CopilotExpressRouter
        ? true
        : false;

const mustNotCarryExpressRouterMembers: HasExpressRouterMember = false;

/** It must still be callable as middleware... */
declare const copilotRouter: CopilotExpressRouter;
const callableAsMiddleware: (
  req: unknown,
  res: unknown,
  next: (err?: unknown) => void,
) => void = copilotRouter;

/** ...and must still expose the Channels surface. */
const channelsStillTyped: ChannelsControl | undefined = copilotRouter.channels;

void mustNotCarryExpressRouterMembers;
void callableAsMiddleware;
void channelsStillTyped;
