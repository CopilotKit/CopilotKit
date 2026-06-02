import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the showcase root directory.
 *
 * Local (source tree): this module compiles to `showcase/harness/dist/cli/
 * config.js`, so `../../..` walks `dist/cli` → `dist` → `harness` → wait,
 * that lands at `showcase/harness`. The historical derivation walked
 * `../../..` from the SOURCE layout (`src/cli/config.ts`) and resolved to
 * `showcase/`. In the COMPILED runtime image the same relative walk from
 * `/app/dist/cli/config.js` overshoots to `/` — three `..` from
 * `/app/dist/cli` is `/`, NOT `/app/showcase`. That broke
 * `resolveIntegrationDir`, which then probed `/integrations/<slug>` instead
 * of the `/app/showcase/integrations/<slug>` the Dockerfile copies specs to,
 * yielding "No Playwright e2e suite found" for every in-container D6 run.
 *
 * Honor an explicit `SHOWCASE_DIR` env override (set to `/app/showcase` in
 * the runtime image — see Dockerfile) as the authoritative value when
 * present; fall back to the relative walk for the local CLI path where the
 * env var is unset. This makes the path resolve correctly in BOTH the image
 * and the local source tree without a host-specific guess.
 */
const SHOWCASE_DIR_FALLBACK = path.resolve(__dirname, "../../..");

/**
 * The showcase root for THIS process. Read at config-load time (not pinned at
 * module import) so the env override is honored deterministically and is
 * unit-testable. Empty/unset → the relative-walk fallback above.
 */
function resolveShowcaseDir(): string {
  const override = process.env.SHOWCASE_DIR;
  return override && override.length > 0 ? override : SHOWCASE_DIR_FALLBACK;
}

export interface LocalConfig {
  showcaseDir: string;
  composeFile: string;
  localPorts: Record<string, number>;
  pocketbase: {
    url: string;
    email: string;
    password: string;
  };
  aimockUrl: string;
  dashboardUrl: string;
  dashboardPort: number;
}

export function loadConfig(): LocalConfig {
  // Resolve the showcase root once per load. In the runtime image this comes
  // from the `SHOWCASE_DIR=/app/showcase` env set in the Dockerfile; locally
  // it falls back to the relative walk. EVERY downstream path (ports file,
  // compose file, `showcaseDir` for `resolveIntegrationDir`) derives from
  // this single value so they cannot diverge between local and image.
  const showcaseDir = resolveShowcaseDir();
  // Honor LOCAL_PORTS_FILE env var (set by isolation overlay) so the harness
  // reads offset ports from a temp file instead of the checked-in original.
  const portsFile =
    process.env.LOCAL_PORTS_FILE ||
    path.join(showcaseDir, "shared/local-ports.json");
  // `local-ports.json` is the host-side dev port map (`bin/showcase up`).
  // The D6 probe path NEVER consults `localPorts` — it supplies a
  // `baseUrlOverride` directly (the discovered/injected service URL), so
  // `getPackageUrl()` is never reached. The file is therefore absent from
  // the runtime image. Tolerate that absence by degrading to an empty map
  // instead of throwing at load time, so the spec-driven runner can still
  // resolve config on the override path. The human CLI path still throws a
  // clear error in `getPackageUrl()` when a slug isn't mapped.
  let localPorts: Record<string, number> = {};
  try {
    localPorts = JSON.parse(fs.readFileSync(portsFile, "utf-8")) as Record<
      string,
      number
    >;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    // ENOENT is the steady-state in the runtime image (probe path uses
    // baseUrlOverride). Any other read/parse error is genuinely unexpected
    // and should surface, so re-throw it.
    if (code !== "ENOENT") {
      throw err;
    }
  }

  return {
    showcaseDir,
    composeFile:
      process.env.SHOWCASE_COMPOSE_FILE ||
      path.join(showcaseDir, "docker-compose.local.yml"),
    localPorts,
    pocketbase: {
      url: process.env.POCKETBASE_URL_LOCAL || "http://localhost:8090",
      // PB 0.22+ rejects `admin@localhost` (single-label TLD) as an invalid
      // email. Use a valid format that the PB validator accepts. The
      // matching admin account is created in the entrypoint / migrations
      // path; the docker-compose env vars and `bin/showcase` superuser
      // bootstrap must agree on this value.
      email: "admin@localhost.dev",
      password: "showcase-local-dev",
    },
    // When --isolate offsets the aimock host port, honor env overrides so the
    // harness's host-side references point at the per-project aimock.
    aimockUrl: process.env.AIMOCK_URL_LOCAL || "http://localhost:4010",
    dashboardUrl: process.env.DASHBOARD_URL_LOCAL || "http://localhost:3200",
    dashboardPort: Number(process.env.DASHBOARD_PORT_LOCAL) || 3200,
  };
}

export function getPackageUrl(slug: string, config: LocalConfig): string {
  const port = config.localPorts[slug];
  if (!port) {
    throw new Error(
      `No local port mapping for slug "${slug}". Check shared/local-ports.json.`,
    );
  }
  return `http://localhost:${port}`;
}
