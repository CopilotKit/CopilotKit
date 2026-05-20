/// <reference path="../pb_data/types.d.ts" />
//
// DEPRECATED — no-op shim retained to preserve migration ordering.
//
// Previously this migration wrote CORS settings to `settings.meta.cors`,
// but PocketBase 0.22 does NOT expose CORS through that field (it does
// not exist on 0.22 settings). The write was a silent no-op and the
// browser dashboard stayed CORS-blocked.
//
// CORS is now handled by a pb_hooks middleware that installs
// Access-Control-Allow-* headers on every response. See
// `../pb_hooks/main.pb.js` for the live code. That file reads the same
// `PB_CORS_ORIGINS` env var for additive operator-configured origins.
//
// ROLLBACK NOTE: removing / editing this migration does NOT change CORS
// behavior. To change allowed origins, edit the allowlist in
// `pb_hooks/main.pb.js` or set `PB_CORS_ORIGINS`. The original migration
// had a rollback arm that attempted to reset `settings.meta.cors` to an
// empty list — that rollback has always been a no-op and remains so.
// Env-configured origins are not tracked in the PB settings store; once
// set via env var, they disappear only when the env var is removed.
migrate(
  () => {
    // No schema / settings change — CORS handled via pb_hooks.
  },
  () => {
    // No-op. Rollback cannot retire origins baked into pb_hooks or
    // sourced from PB_CORS_ORIGINS — see file header.
  },
);
