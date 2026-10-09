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
// ─────────────────────────────────────────────────────────────────────
// TWO PB-0.22 JSVM CONSTRAINTS THIS FILE OBEYS (both verified by booting
// the built image against a real PB 0.22.21 binary — see the PR notes):
//
// 1. Registration hook. `onBeforeServe(...)` is NOT a global JSVM function
//    in 0.22.x — only `$app.onBeforeServe()` exists (a Go method returning
//    a Hook). Calling the bare `onBeforeServe(...)` identifier throws
//    `ReferenceError: onBeforeServe is not defined` at hook load, which
//    crash-loops the server (every request 502s). The documented global
//    entry point for router middleware is `routerUse((next) => (c) => …)`
//    (echo v5 middleware shape — outer fn takes the next handler, returns
//    a `(c) => error` handler).
//
// 2. Self-contained closure. The per-request middleware closure runs in
//    PocketBase's pooled goja runtime, where top-level helper functions
//    and `const`s declared in this file are NOT in scope at request time.
//    Referencing an out-of-closure helper throws a ReferenceError per
//    request, which the router turns into an HTTP 400 on EVERY route
//    (health, collection reads, everything). So ALL logic — the origin
//    allowlist, the env-var augmentation, and the match — is inlined
//    inside the returned `(c) => …` handler. Do not refactor the body out
//    into module-level helpers; it will silently 400 every request.
// ─────────────────────────────────────────────────────────────────────
routerUse((next) => {
  return (c) => {
    // Built-in prod origin baked in so a fresh Railway volume is
    // immediately reachable from the production dashboard without operator
    // env-var configuration. If prod ever moves off
    // dashboard.showcase.copilotkit.ai, change this default — the env var
    // alone won't retire the stale origin. PB_CORS_ORIGINS (comma-
    // separated) augments this list additively for staging / preview.
    const allowlist = ["https://dashboard.showcase.copilotkit.ai"].concat(
      ($os.getenv("PB_CORS_ORIGINS") || "")
        .split(",")
        .map(function (s) {
          return s.trim();
        })
        .filter(function (s) {
          return s.length > 0;
        }),
    );

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
    // don't reject OPTIONS with 401/404.
    if (c.request().method === "OPTIONS") {
      return c.noContent(204);
    }
    return next(c);
  };
});
