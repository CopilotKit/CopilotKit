import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";

import { loadConfig } from "./config.js";

// ---------------------------------------------------------------------------
// loadConfig — SHOWCASE_DIR resolution.
//
// In the runtime image the compiled config.js lives at /app/dist/cli/config.js,
// so its `../../..` relative walk resolves to `/`, NOT `/app/showcase`. That
// made resolveIntegrationDir probe `/integrations/<slug>` and miss the specs
// the Dockerfile copies to `/app/showcase/integrations/<slug>`, yielding
// "No Playwright e2e suite found" for every in-container D6 run. The fix
// honors an explicit `SHOWCASE_DIR` env override (set to `/app/showcase` in
// the image), falling back to the relative walk locally.
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "SHOWCASE_DIR",
  "LOCAL_PORTS_FILE",
  "SHOWCASE_COMPOSE_FILE",
] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

describe("loadConfig — showcaseDir resolution", () => {
  it("honors the SHOWCASE_DIR env override for showcaseDir and derived paths", () => {
    process.env.SHOWCASE_DIR = "/app/showcase";
    // local-ports.json won't exist under /app/showcase in this test env;
    // loadConfig tolerates ENOENT and degrades localPorts to {}.
    const cfg = loadConfig();
    expect(cfg.showcaseDir).toBe("/app/showcase");
    // Compose file is derived from the same root.
    expect(cfg.composeFile).toBe(
      path.join("/app/showcase", "docker-compose.local.yml"),
    );
  });

  it("falls back to the relative-walk root when SHOWCASE_DIR is unset", () => {
    delete process.env.SHOWCASE_DIR;
    const cfg = loadConfig();
    // The source tree walk lands on the showcase root; assert the path ends
    // with `/showcase` rather than pinning an absolute host path.
    expect(cfg.showcaseDir.endsWith(`${path.sep}showcase`)).toBe(true);
    expect(cfg.composeFile).toBe(
      path.join(cfg.showcaseDir, "docker-compose.local.yml"),
    );
  });

  it("treats an empty SHOWCASE_DIR as unset (falls back to the relative walk)", () => {
    process.env.SHOWCASE_DIR = "";
    const cfg = loadConfig();
    expect(cfg.showcaseDir.endsWith(`${path.sep}showcase`)).toBe(true);
  });

  it("uses a PB-valid superuser email (admin@localhost is rejected by PB)", () => {
    const cfg = loadConfig();
    // Must not be the single-label-TLD form PocketBase rejects.
    expect(cfg.pocketbase.email).not.toBe("admin@localhost");
    // Sanity: a well-formed address with a dotted domain.
    expect(cfg.pocketbase.email).toMatch(/@.+\..+/);
  });
});
