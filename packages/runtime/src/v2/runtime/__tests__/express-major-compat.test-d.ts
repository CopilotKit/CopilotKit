/**
 * Type-level regression for #7276.
 *
 * `CopilotExpressRouter` used to be `Router & { channels? }`, with `Router`
 * coming from the runtime's own Express 4 types. An Express 5 app could not
 * mount it — `app.use(copilotRouter)` failed to compile in the consumer's
 * project, because a v4-typed router is not assignable to a v5 `use()`.
 *
 * The fix declares the shape structurally instead: the call signature `use()`
 * accepts in both majors, plus the router-configuration methods both majors
 * share. These assertions pin that shape so a later edit cannot quietly
 * re-introduce an Express-derived type.
 *
 * Note on what this file can and cannot prove. The real failure only reproduces
 * in a consumer project compiled with `strict: true` against `@types/express@5`;
 * this package sets `strict: false` and resolves `@types/express@4`, so a plain
 * assignability assertion here passes under both the broken and the fixed type
 * and would be worthless. The `keyof` assertions below are
 * strictness-independent: they fail the moment the type carries members that
 * only Express's own `Router` declares. The end-to-end proof is
 * `type-fixtures/express5/`, a `strict: true` consumer compiled against real
 * `@types/express@5` and the built `dist` declarations by `check-dts`.
 *
 * Checked by the package `check-types` target, whose tsconfig includes this
 * directory. Nothing runs at runtime.
 */
import type { CopilotExpressRouter } from "../endpoints/express";
import type { ChannelsControl } from "../core/channel-manager";

type Has<K extends string> = K extends keyof CopilotExpressRouter
  ? true
  : false;

/**
 * Members that exist ONLY on Express's own `Router`. Our exported type must not
 * carry them: taking them means taking one major's declaration, which is the
 * bug. `param`, `route` and `stack` are declared by both `@types/express@4` and
 * `@types/express@5`, so either major re-pinned here trips this.
 */
const mustNotCarryParam: Has<"param"> = false;
const mustNotCarryRoute: Has<"route"> = false;
const mustNotCarryStack: Has<"stack"> = false;

/**
 * The router-configuration surface consumers actually use. Declared
 * structurally, not inherited from Express. Removing these silently breaks
 * anyone who adds middleware or routes to the value we hand back.
 */
const keepsUse: Has<"use"> = true;
const keepsGet: Has<"get"> = true;
const keepsPost: Has<"post"> = true;
const keepsPut: Has<"put"> = true;
const keepsPatch: Has<"patch"> = true;
const keepsDelete: Has<"delete"> = true;
const keepsOptions: Has<"options"> = true;
const keepsAll: Has<"all"> = true;

/** It must still be callable as middleware... */
declare const copilotRouter: CopilotExpressRouter;
const callableAsMiddleware: (
  req: unknown,
  res: unknown,
  next: (err?: unknown) => void,
) => void = copilotRouter;

/** ...must still expose the Channels surface... */
const channelsStillTyped: ChannelsControl | undefined = copilotRouter.channels;

/** ...and its configuration methods must stay chainable. */
const chains: CopilotExpressRouter = copilotRouter.use(() => {}).get("/x");

void mustNotCarryParam;
void mustNotCarryRoute;
void mustNotCarryStack;
void keepsUse;
void keepsGet;
void keepsPost;
void keepsPut;
void keepsPatch;
void keepsDelete;
void keepsOptions;
void keepsAll;
void callableAsMiddleware;
void channelsStillTyped;
void chains;
