import { createRequire } from "node:module";

/**
 * How `loadExpress` reaches the module system. `createRequire(...)` returns
 * exactly this shape; a test can pass its own.
 */
export interface RequireLike {
  (specifier: string): any;
  resolve(specifier: string): string;
}

/**
 * Load `express` at call time rather than at module load time.
 *
 * `express` is an OPTIONAL peer: an app that mounts the Hono or Node adapter
 * never installs it. The Express adapter is re-exported from the
 * `@copilotkit/runtime/v2` barrel, so a static `import express from "express"`
 * there would make that barrel unimportable for every consumer who does not use
 * Express. Loading it inside the factory keeps the barrel free of Express and
 * moves the failure to the only place it is a real failure: calling an Express
 * factory without Express installed.
 *
 * This lives in its own module, and not beside the factory, for two reasons: it
 * is not part of the published surface (the endpoints barrel does not re-export
 * it), and a test can reach it directly and inject `requireFrom`.
 *
 * `scripts/validate-optional-peer-entries.ts` is what keeps the loading lazy: it
 * fails if any entry point reaches an optional peer at module-initialization
 * time, in either published format.
 */
export function loadExpress(
  requireFrom: RequireLike = createRequire(import.meta.url) as RequireLike,
): { Router: () => any } {
  // Resolve and evaluate in two steps, so that only a RESOLUTION failure is
  // reported as "not installed". Wrapping the whole load would also catch
  // express throwing while it evaluates -- a broken transitive dependency, a
  // failed native binding, a syntax error in a patched copy -- and would send
  // the reader off to install a package they already have. Those errors must
  // surface as themselves.
  try {
    requireFrom.resolve("express");
  } catch (cause) {
    throw new Error(
      "@copilotkit/runtime: the Express adapter requires `express`, which is an " +
        "optional peer dependency and is not installed. Install it with " +
        "`npm install express` (^4.21.2 || ^5.0.0), or mount the Hono adapter " +
        "from `@copilotkit/runtime/v2/hono` instead.",
      { cause },
    );
  }

  return requireFrom("express");
}
