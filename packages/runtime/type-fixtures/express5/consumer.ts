/**
 * The #7276 reproduction, as a compile-only consumer.
 *
 * `CopilotExpressRouter` used to be `Router & { channels? }`, with `Router`
 * taken from the runtime's own `@types/express@4`. `Request.param()` exists in
 * the v4 types and not in the v5 types, so a v4-typed router is not assignable
 * to an Express 5 `app.use()` and this file did not compile:
 *
 *     Property 'param' is missing in type 'Request<...>' but required in type ...
 *
 * `app.use(...)` below is the assertion: this is the mount that did not compile.
 *
 * What this file does NOT prove. `paths` maps `express` for the whole program,
 * so it cannot stage a tree where the library sees major 4 and the app sees
 * major 5 -- the mismatch itself. The guard against that is
 * `validate-optional-peer-entries.ts`'s sibling, `validate-dts-imports.ts`: it
 * fails if any published declaration imports `express` at all, which is what
 * re-pinning `CopilotExpressRouter` to either major's `Router` would emit. A
 * declaration that never names `express` cannot disagree with the consumer
 * about its major. This file proves the other half -- that what we do publish
 * mounts on Express 5 under a consumer's own `strict: true`.
 */
import express from "express";
import {
  createCopilotExpressHandler,
  createCopilotEndpointSingleRouteExpress,
} from "@copilotkit/runtime/v2/express";
import type { CopilotExpressRouter } from "@copilotkit/runtime/v2/express";
import type { CopilotRuntime } from "@copilotkit/runtime/v2";

declare const runtime: CopilotRuntime;

const app = express();

// Multi-route adapter, mounted the way the docs show.
app.use(createCopilotExpressHandler({ runtime, basePath: "/copilotkit" }));

// Single-route adapter, same mount.
app.use(createCopilotEndpointSingleRouteExpress({ runtime, basePath: "/api" }));

// Mounted under an explicit path, the other documented form.
app.use("/nested", createCopilotExpressHandler({ runtime, basePath: "/" }));

// The Channels surface survives the widening.
const router: CopilotExpressRouter = createCopilotExpressHandler({
  runtime,
  basePath: "/",
});
void router.channels?.ready;

// A consumer may still configure the returned router. This is the surface
// CodeRabbit flagged on #7278: dropping it would break these callers.
router.use((_req: unknown, _res: unknown, next: (err?: unknown) => void) =>
  next(),
);
router.get("/health", (_req: unknown, res: any) => res.sendStatus(200));
