import { defineConfig } from "@playwright/test";
// Pure, import-free module (see its header) — safe to pull into this config
// without dragging any client skin code along. It is the single source of truth
// for the skin the unlocked server serves at its default route.
import { defaultSkinId } from "./src/shell/skins-config";

// The LOCK_SKIN deploy shape gets its OWN server and project. It cannot share
// the main one: the lock is a boot-time server env, so the two shapes are two
// processes by definition. `locked-skin.spec.ts` runs only here; everything else
// runs only against the unlocked server.
const UNLOCKED_PORT = process.env.UNLOCKED_E2E_PORT ?? "3000";
const LOCKED_PORT = process.env.LOCKED_E2E_PORT ?? "3100";
const LOCKED_SKIN = "banking";
const LOCKED_SPEC = /locked-skin\.spec\.ts/;
// `ogui-routing.spec.ts` has its own config (playwright.ogui.config.ts) and is
// excluded here. It must be repeated in the unlocked project's own testIgnore:
// a project-level testIgnore REPLACES the config-level one rather than adding to
// it, so listing it only at the top level would silently re-admit those specs.
const OGUI_SPEC = /ogui-routing\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: OGUI_SPEC,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { trace: "on-first-retry" },
  projects: [
    {
      name: "unlocked",
      use: { baseURL: `http://localhost:${UNLOCKED_PORT}` },
      testIgnore: [LOCKED_SPEC, OGUI_SPEC],
    },
    {
      name: "locked",
      use: { baseURL: `http://localhost:${LOCKED_PORT}` },
      testMatch: LOCKED_SPEC,
    },
  ],
  // Three servers, all started in PARALLEL by Playwright (webServer entries carry no
  // ordering guarantee): aimock (deterministic LLM), the unlocked dev server, and the
  // locked single-tenant dev server. aimock need NOT win the race against the dev
  // servers — the runtime resolves OPENAI_BASE_URL per REQUEST, not at boot, so aimock
  // only has to be up before the first agent run, which happens well after each
  // server's readiness probe passes. The memory-learning E2E additionally needs the
  // docker memory stack already running (see README / e2e/memory-learning.spec).
  webServer: [
    {
      // Deterministic LLM for the memory E2E. See e2e/aimock-server.mjs for the
      // fixture wiring + the CLI fallback if the programmatic API differs.
      command: "node e2e/aimock-server.mjs",
      url: `http://localhost:${process.env.AIMOCK_PORT ?? "7099"}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm dev",
      // Probe a real rendered skin page, not `/` (which now only 307-redirects
      // to the default skin) — this waits until a skin actually compiles and
      // renders. Both the port and the skin id are derived from the same sources
      // the baseURL and the app use (UNLOCKED_PORT + defaultSkinId), so the probe
      // can never silently drift from what the server actually serves.
      url: `http://localhost:${UNLOCKED_PORT}/${defaultSkinId}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Existing LLM-free smokes only need *some* OPENAI_API_KEY so the route's
        // BuiltInAgent import doesn't crash at boot. The memory E2E additionally
        // points the agent at aimock and runs the runtime in Intelligence mode.
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "test",
        OPENAI_BASE_URL:
          process.env.OPENAI_BASE_URL ??
          `http://localhost:${process.env.AIMOCK_PORT ?? "7099"}/v1`,
        INTELLIGENCE_API_URL:
          process.env.INTELLIGENCE_API_URL ?? "http://localhost:7250",
        INTELLIGENCE_GATEWAY_WS_URL:
          process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:7253",
        INTELLIGENCE_API_KEY:
          process.env.INTELLIGENCE_API_KEY ??
          "cpk_sPRVSEED_seed0privat0longtoken00",
        INTELLIGENCE_USER_ID:
          process.env.INTELLIGENCE_USER_ID ?? "jordan-beamson",
        NEXT_TELEMETRY_DISABLED: "1",
        // Passed so the port this server listens on stays tied to UNLOCKED_PORT —
        // the same constant the baseURL and readiness probe use. Default 3000
        // matches `next dev`'s own default, so this is a no-op unless overridden.
        PORT: UNLOCKED_PORT,
        // Pin the single-tenant gate OFF for a dev server *Playwright starts*.
        // But reuseExistingServer is set for local runs, so a warm run adopts an
        // already-running `pnpm dev` and this whole env block is skipped — the
        // developer's ambient LOCK_SKIN (or .env) then wins. So: if you have
        // LOCK_SKIN set locally, stop your dev server before running the suite.
        // This applies to BOTH servers Playwright would otherwise adopt: a dev
        // server on UNLOCKED_PORT (3000) here, and — less likely, but the locked
        // project reuses too — anything already on LOCKED_PORT (3100), which would
        // skip that project's env block and adopt the wrong lock.
        // How it breaks depends on the ambient locked skin: a lock whose id is not
        // defaultSkinId (e.g. logistics) 404s the default-skin readiness probe
        // above (derived from defaultSkinId), so Playwright never considers the
        // server ready and the run dies at webServer startup with a timeout —
        // before any spec runs. A lock that IS defaultSkinId passes the probe, and
        // then the /airline specs fail on their switcher assertions instead.
        // Either way, the fix is the same: stop the dev server first. In CI
        // reuseExistingServer is false, so this pin always applies. (An explicit
        // env wins on the servers we start because
        // Next's dotenv loading never overrides an already-set process.env var.)
        LOCK_SKIN: "",
      },
    },
    {
      // The single-tenant shape. Exists because LOCK_SKIN's headline behaviour —
      // the skin served AT `/`, with prefix-free links — had NO automated
      // coverage otherwise: every other spec pins the gate off, and the defect
      // this guards against (a hardcoded prefix reappearing in the address bar)
      // still renders a working page, so nothing else notices.
      command: "pnpm dev",
      // `/` IS the app here, so it doubles as the readiness probe — and probing
      // it also proves the proxy rewrote rather than 404ing.
      url: `http://localhost:${LOCKED_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "test",
        NEXT_TELEMETRY_DISABLED: "1",
        PORT: LOCKED_PORT,
        // Two `next dev` processes cannot share one `.next` — they overwrite
        // each other's build output. next.config.mjs reads this; tsconfig.json
        // lists the matching `.next-locked/types` globs, and eslint.config.mjs
        // ignores the directory (ESLint does not read .gitignore).
        //
        // KNOWN CHURN: Next rewrites the tracked `next-env.d.ts` to reference
        // whichever dist dir booted LAST, so a full run leaves it pointing at
        // `.next-locked`. Discard that hunk before committing — committing it
        // breaks a clean checkout, whose `.next-locked` does not exist. Any
        // `next build`/`next dev` restores it. (The file already churned before
        // this project existed; this makes it churn on e2e runs too.)
        NEXT_DIST_DIR: ".next-locked",
        LOCK_SKIN: LOCKED_SKIN,
      },
    },
  ],
});
