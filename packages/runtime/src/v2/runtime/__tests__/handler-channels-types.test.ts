import { test, expect } from "vitest";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";
import type { IdentifyUserCallback } from "../core/runtime";
import type { CopilotKitIntelligence } from "../intelligence-platform";
import type { Channel } from "@copilotkit/channels";

/*
 * OSS-473 — compile-time regression test.
 *
 * These assertions are verified by `tsc --noEmit` (the `check-types` gate), not
 * at runtime, so the substantive checks live in an uninvoked function whose body
 * `tsc` still type-checks. A single trivial runtime `test` keeps the vitest run
 * from failing on an empty suite.
 *
 * NOTE: this package compiles with `strict: false` (so `strictNullChecks` is
 * off). The optional-vs-required proof therefore probes the property's
 * optionality *modifier* structurally (`{} extends Pick<T, K>`) instead of
 * testing for `undefined`, which would be indistinguishable with null checks
 * disabled. Assertions use the `assertTrue<T>()` helper rather than
 * `@ts-expect-error` so the auto-formatter cannot reflow a line and detach a
 * directive from the error it suppresses.
 */

/** `true` iff key `K` of `T` is a REQUIRED (non-optional) property. */
type KeyIsRequired<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;

/** Compile error (constraint violation) unless `T` resolves to exactly `true`. */
function assertTrue<_T extends true>(): void {}

// Purely type-only fixtures — never constructed at runtime.
declare const intelligence: CopilotKitIntelligence;
declare const identifyUser: IdentifyUserCallback;
declare const support: Channel;

/**
 * Never invoked. Exists so `tsc` type-checks the PR's documented
 * `handler.channels.ready(...)` snippet verbatim and the surrounding contracts.
 */
async function _channelsHandlerTypeContracts(): Promise<void> {
  // An Intelligence runtime declaring at least one Channel.
  const runtime = new CopilotRuntime({
    agents: {},
    intelligence,
    identifyUser,
    channels: [support],
  });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
  });

  // Documented usage — verbatim, with NO `!` and NO `?.`.
  const c = handler.channels;
  await handler.channels.ready({ timeoutMs: 10 });
  await c.stop();

  // The discriminating proof: `.channels` is REQUIRED here. This assertion fails
  // to compile against the old optional-only handler type and passes once the
  // branded overload lands.
  assertTrue<KeyIsRequired<typeof handler, "channels">>();

  // A plain SSE runtime's handler must keep `.channels` OPTIONAL (not required).
  const sseHandler = createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({ agents: {} }),
  });
  assertTrue<
    KeyIsRequired<typeof sseHandler, "channels"> extends false ? true : false
  >();

  // Opting out of activation keeps the optional shape even for a runtime that
  // declares Channels.
  const optedOut = createCopilotRuntimeHandler({
    runtime,
    activateChannels: false,
  });
  assertTrue<
    KeyIsRequired<typeof optedOut, "channels"> extends false ? true : false
  >();
}

test("handler.channels type contracts are enforced at compile time", () => {
  expect(typeof _channelsHandlerTypeContracts).toBe("function");
});
