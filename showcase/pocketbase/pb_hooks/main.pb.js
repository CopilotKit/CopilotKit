/// <reference path="../pb_data/types.d.ts" />
//
// CORS wiring for PocketBase 0.22.
//
// Context: the browser dashboard at
// https://dashboard.showcase.copilotkit.ai talks directly to PocketBase
// (see showcase/shell-dashboard/src/lib/pb.ts) for live status + status
// history. That cross-origin fetch requires the server to emit
// Access-Control-Allow-Origin for our allowlisted origins.
//
// PB 0.22 does NOT expose CORS through `settings.meta.cors`; that field
// simply does not exist on 0.22 settings. The earlier
// `1745194000_cors.js` migration wrote to it anyway — a silent no-op.
// The correct integration point is a pb_hooks middleware that:
//   1. Handles OPTIONS preflight by returning 204 with the CORS headers.
//   2. Echoes Access-Control-Allow-Origin on the actual response when the
//      request Origin is in our allowlist.
//
// Hooks files are loaded automatically by `pocketbase serve` from
// `--hooksDir` (default `<dataDir>/../pb_hooks` — see Dockerfile layout).
// Nothing else is required to activate them.
//
// PB_CORS_ORIGINS (comma-separated) augments the baked-in prod origin
// additively. An operator can add staging / preview origins without a
// code change; removing the prod default still requires editing this
// file (env var cannot retire it).
//
// Registration nuance: PB 0.22's JSVM excludes `onBeforeServe` from
// auto-binding (see plugins/jsvm/binds.go v0.22.21 excludeHooks), so the
// previous `onBeforeServe((e) => e.router.use(...))` was a silent no-op
// that would have raised `ReferenceError: onBeforeServe is not defined`
// at load time had PB not silently swallowed pb_hooks load errors.
// `routerPre` is the supported module-scope binding; internally it wraps
// `OnBeforeServe + Router.Pre`, giving the same pre-routing hook point.
//
// Inlining nuance: the JSVM wraps the middleware function by calling
// `m.String()` and re-compiling it inside a fresh executor VM (see
// `wrapMiddlewares` in plugins/jsvm/binds.go). Module-scope `const`s
// and helper functions defined outside the middleware body are NOT in
// that executor's scope, so referencing them from the handler throws
// `ReferenceError` and PB returns a generic 400. The CORS helpers must
// therefore live inside the middleware closure — duplication is the
// price of routerPre's re-execution model. `$os.getenv` survives because
// it's a JSVM global binding, not a module-scope identifier.
routerPre((next) => {
  return (c) => {
    // Built-in prod origin baked in so a fresh Railway volume is
    // immediately reachable from the production dashboard without
    // requiring operator env-var configuration. If prod ever moves off
    // dashboard.showcase.copilotkit.ai, change this default — env var
    // alone won't retire the stale origin.
    const CORS_DEFAULT_ORIGINS = ["https://dashboard.showcase.copilotkit.ai"];
    const extra = ($os.getenv("PB_CORS_ORIGINS") || "")
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s.length > 0;
      });
    const allowlist = CORS_DEFAULT_ORIGINS.concat(extra);
    const origin = c.request().header.get("Origin");
    let allowed = false;
    if (origin) {
      for (let i = 0; i < allowlist.length; i++) {
        if (allowlist[i] === origin) {
          allowed = true;
          break;
        }
      }
    }
    if (allowed) {
      c.response().header().set("Access-Control-Allow-Origin", origin);
      c.response().header().set("Vary", "Origin");
      c.response()
        .header()
        .set(
          "Access-Control-Allow-Methods",
          "GET, POST, PATCH, DELETE, OPTIONS",
        );
      c.response()
        .header()
        .set(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, X-Requested-With",
        );
      c.response().header().set("Access-Control-Max-Age", "600");
    }
    // Short-circuit preflight so downstream handlers (auth, routing)
    // don't reject OPTIONS with 401/404, and so PB's own echo CORS
    // middleware (which runs in the Use() phase, after Pre()) doesn't
    // overwrite our Access-Control-Allow-Origin with `*`.
    if (c.request().method === "OPTIONS") {
      return c.noContent(204);
    }
    return next(c);
  };
});
