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
 * ONE consumer, compiled TWICE: `express4/tsconfig.json` and
 * `express5/tsconfig.json` each include this file and point `express` at their
 * own major. A single file keeps the two majors from drifting apart, and the
 * declared peer range is `^4.18.0 || ^5.0.0`, so both halves need proving.
 *
 * What this file does NOT prove. Each project maps `express` for its whole
 * program, so neither can stage a tree where the library sees major 4 and the
 * app sees major 5 -- the mismatch itself. The guard against that is
 * `validate-optional-peer-entries.ts`'s sibling, `validate-dts-imports.ts`: it
 * fails if any published declaration imports `express` at all, which is what
 * re-pinning `CopilotExpressRouter` to either major's `Router` would emit. A
 * declaration that never names `express` cannot disagree with the consumer
 * about its major. This file proves the other half -- that what we do publish
 * mounts on both majors under a consumer's own `strict: true`.
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
router.route("/echo").get((_req: unknown, res: any) => res.sendStatus(204));
router.param("id", (_req: unknown, _res: unknown, next: () => void) => next());
