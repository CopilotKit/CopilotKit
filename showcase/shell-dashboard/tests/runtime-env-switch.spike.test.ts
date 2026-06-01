import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

// This test boots `next build` ONCE then `next start` TWICE with two
// different POCKETBASE_URL / SHELL_URL / OPS_BASE_URL value sets,
// curls the served HTML on each, and asserts the injected
// __SHOWCASE_CONFIG__ JSON matches the env values for that boot.
//
// If no-rebuild env switching ever regresses (someone re-bakes a URL
// into the bundle), this test fails because the first boot's URL
// values leak into the second boot's HTML.
//
// The /api/ops/* proxy is served by the Route Handler at
// `src/app/api/ops/[...path]/route.ts`, which reads OPS_BASE_URL from
// process.env at REQUEST time — so the build does NOT need OPS_BASE_URL
// at all. We still pass a sentinel placeholder at build to prove the
// build tolerates (and ignores) it; no boot ever uses that value.
// The properties under test (the inlined __SHOWCASE_CONFIG__ script
// emitted by `src/app/layout.tsx`) are read from process.env at
// request time by `getRuntimeConfig()` and therefore reflect the
// per-boot env values, NOT the build-time placeholder.

const PORT_A = 3801;
const PORT_B = 3802;

// `__dirname` is undefined under ESM (vitest runs ESM); use Node
// 20.11+'s `import.meta.dirname` for the path-to-shell-dashboard
// resolution.
const SHELL_DASHBOARD_DIR = import.meta.dirname + "/..";

// Sentinel passed at `next build` time purely to prove the build
// tolerates and ignores it (the proxy now resolves OPS_BASE_URL at
// request time in the Route Handler, not at build). Per-boot env vars
// below drive the __SHOWCASE_CONFIG__ injection the test asserts on.
const BUILD_TIME_OPS_PLACEHOLDER = "http://build-placeholder.invalid";

describe("Option B: one artifact, two env values, no rebuild", () => {
  beforeAll(() => {
    // Build ONCE. The placeholder OPS_BASE_URL is passed only to prove
    // the build ignores it — the /api/ops proxy resolves OPS_BASE_URL at
    // request time in the Route Handler. No POCKETBASE_URL / SHELL_URL —
    // those are read at request time by getRuntimeConfig() and must not
    // be required at build.
    //
    // Use `npm run build` (not `npx next build` directly) so the
    // `prebuild` script runs and the generated data fixtures
    // (`src/data/registry.json`, `catalog.json`, `docs-status.json`)
    // exist before webpack walks the import tree.
    execSync("npm run build", {
      cwd: SHELL_DASHBOARD_DIR,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "production",
        OPS_BASE_URL: BUILD_TIME_OPS_PLACEHOLDER,
      },
    });
  }, 180_000);

  async function bootAndProbe(
    port: number,
    env: Record<string, string>,
  ): Promise<{ pocketbaseUrl: string; shellUrl: string; opsBaseUrl: string }> {
    const proc: ChildProcess = spawn(
      "npx",
      ["next", "start", "-p", String(port)],
      {
        cwd: SHELL_DASHBOARD_DIR,
        env: { ...process.env, NODE_ENV: "production", ...env },
        stdio: "pipe",
        detached: false,
      },
    );
    try {
      // Wait for the server to be ready by polling /.
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://localhost:${port}/`);
          if (res.ok) break;
        } catch {
          // not up yet
        }
        await wait(500);
      }
      const html = await (await fetch(`http://localhost:${port}/`)).text();
      // Extract the inlined runtime config from the injected
      // <script id="__showcase_config__">. The injection pattern
      // is `window.__SHOWCASE_CONFIG__={"...":"..."};`.
      const match = html.match(/window\.__SHOWCASE_CONFIG__=(\{[^<]*?\});/);
      if (!match) throw new Error("no __SHOWCASE_CONFIG__ in HTML");
      // The serialized payload has < escaped as < — JSON.parse
      // accepts it as-is for our keys (URLs don't contain <).
      const parsed = JSON.parse(match[1]);
      return parsed;
    } finally {
      proc.kill("SIGTERM");
      // Drain — give the OS a beat to release the port before the
      // next iteration binds it.
      await wait(500);
    }
  }

  it("serves env-A URLs on the first boot", async () => {
    const cfg = await bootAndProbe(PORT_A, {
      POCKETBASE_URL: "https://pb-env-a.example.com",
      SHELL_URL: "https://shell-env-a.example.com",
      // Server proxy target (read by the Route Handler) — must NOT leak
      // into the injected client config.
      OPS_BASE_URL: "https://ops-env-a.example.com",
      // Client-direct override (opt-in) — THIS is what flows into the
      // injected __SHOWCASE_CONFIG__.opsBaseUrl.
      NEXT_PUBLIC_OPS_DIRECT_BASE_URL: "https://ops-direct-env-a.example.com",
    });
    expect(cfg.pocketbaseUrl).toBe("https://pb-env-a.example.com");
    expect(cfg.shellUrl).toBe("https://shell-env-a.example.com");
    // opsBaseUrl reflects the client-direct override, NOT the server
    // proxy target OPS_BASE_URL.
    expect(cfg.opsBaseUrl).toBe("https://ops-direct-env-a.example.com");
  }, 60_000);

  it("serves env-B URLs on the second boot of THE SAME ARTIFACT", async () => {
    const cfg = await bootAndProbe(PORT_B, {
      POCKETBASE_URL: "https://pb-env-b.example.com",
      SHELL_URL: "https://shell-env-b.example.com",
      OPS_BASE_URL: "https://ops-env-b.example.com",
      NEXT_PUBLIC_OPS_DIRECT_BASE_URL: "https://ops-direct-env-b.example.com",
    });
    expect(cfg.pocketbaseUrl).toBe("https://pb-env-b.example.com");
    expect(cfg.shellUrl).toBe("https://shell-env-b.example.com");
    expect(cfg.opsBaseUrl).toBe("https://ops-direct-env-b.example.com");
  }, 60_000);

  it("does NOT leak the server proxy target OPS_BASE_URL into the client config", async () => {
    // Regression for the staging no-data bug: a deploy that sets ONLY
    // OPS_BASE_URL (server proxy target) and no client-direct override
    // must inject an EMPTY opsBaseUrl so the client falls through to the
    // same-origin /api/ops proxy instead of fetching the harness
    // cross-origin (CORS-blocked + wrong path).
    const cfg = await bootAndProbe(PORT_A, {
      POCKETBASE_URL: "https://pb-leak.example.com",
      SHELL_URL: "https://shell-leak.example.com",
      OPS_BASE_URL: "https://harness-should-not-leak.example.com",
    });
    expect(cfg.opsBaseUrl).toBe("");
  }, 60_000);

  afterAll(() => {
    // Nothing to clean — the .next/ artifact is intentionally
    // left in place for inspection; the test doesn't touch it
    // between runs.
  });
});
