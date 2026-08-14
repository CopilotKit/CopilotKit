import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(__dirname, "../../..");

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
  /**
   * Host-side base URL of the UNIFIED Next.js frontend
   * (`showcase/frontends/nextjs`, compose service `frontend-nextjs`,
   * host port 3200 → container 3000).
   *
   * This is "where the demos are served" for a migrated slug, and it is a
   * DIFFERENT axis from "where the agent is". Keeping them separate is the
   * whole point of this field: after a migration a slug's demos live at
   * `<frontendBaseUrl>/<slug>/demos/<id>` while its agent stays on its own
   * origin (`http://localhost:<localPorts[slug]>`). One value cannot express
   * both, and collapsing them is what makes a dead agent look "verified".
   */
  frontendBaseUrl: string;
  /** Host port the unified frontend is published on. */
  frontendPort: number;
  /**
   * Slugs whose demos are served by the unified frontend instead of by their
   * own integration container.
   *
   * DERIVED FROM THE MANIFESTS — `demo_frontend: unified` in
   * `showcase/integrations/<slug>/manifest.yaml`. That field is the single
   * tracked source of truth for the migration; see its `$comment` in
   * `showcase/shared/manifest.schema.json`.
   *
   * THERE IS NO ENV OVERRIDE, ON PURPOSE. This used to read
   * `SHOWCASE_UNIFIED_FRONTEND_SLUGS`, which was the ONLY consumer of that
   * variable and a second, uncompared spelling of the same state — the compose
   * side read `LOCAL_SERVICE_URL_<SLUG>` instead, and nothing checked that the
   * two agreed. Migrating a slug meant setting both and hoping. Keeping the
   * variable as a "local override" would have preserved exactly that failure
   * mode: an override that disagrees with the manifest IS the half-migrated
   * state this field exists to make impossible. A slug is migrated by editing
   * its manifest and re-running the emitter — one file, one command (see
   * `showcase/scripts/emit-local-services-env.ts`).
   *
   * The compose side cannot simply reuse the same value: its URLs are
   * CONTAINER-network (`http://frontend-nextjs:3000/<slug>`) and unreachable
   * from the host CLI. Both sides derive the SAME BOOLEAN from the same
   * manifest field and compose their own URL from it, and
   * `unified-frontend-sources.test.ts` asserts the two views agree for every
   * slug.
   */
  unifiedFrontendSlugs: ReadonlySet<string>;
}

/**
 * The `demo_frontend` value that means "the unified frontend serves this
 * slug's demos". Mirrors `DemoFrontend` in `showcase/scripts/lib/manifest.ts`,
 * which this package cannot import (it lives in the private
 * `@copilotkit/showcase-scripts` package the harness does not depend on) —
 * the same constraint documented for `AGENT_KINDS` there.
 */
const UNIFIED_DEMO_FRONTEND = "unified";

/**
 * Read every integration manifest and collect the slugs on the unified
 * frontend.
 *
 * Deliberately a hand-rolled line scan rather than a YAML parse: this runs on
 * every `bin/showcase` invocation, `demo_frontend` is a top-level scalar, and
 * the harness's other manifest reader (`targets.ts`) already pays the js-yaml
 * cost per slug when it needs the whole document. The regex is anchored at
 * column 0 so a nested key of the same name (there is none) or a commented
 * mention cannot match.
 *
 * A MISSING FIELD MEANS "integration", matching `DEFAULT_DEMO_FRONTEND` in
 * `showcase/scripts/lib/manifest.ts`. An UNRECOGNISED value is a hard error:
 * silently treating `demo_frontend: unifed` as un-migrated is precisely the
 * quiet-wrong-answer this whole change removes, and the JSON schema + the
 * script-side parser both reject it, so the harness must not be the one
 * validator that shrugs.
 */
function readUnifiedFrontendSlugs(showcaseDir: string): ReadonlySet<string> {
  const integrationsDir = path.join(showcaseDir, "integrations");
  const slugs = new Set<string>();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(integrationsDir, { withFileTypes: true });
  } catch {
    // No integrations directory (unit-test fixtures pointing showcaseDir at a
    // temp dir). Nothing is migrated, which is the correct default.
    return slugs;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const manifestPath = path.join(
      integrationsDir,
      entry.name,
      "manifest.yaml",
    );
    let raw: string;
    try {
      raw = fs.readFileSync(manifestPath, "utf-8");
    } catch {
      continue;
    }
    const match = /^demo_frontend:[ \t]*(\S+)[ \t]*$/m.exec(raw);
    if (!match) continue;
    const value = match[1].replace(/^["']|["']$/g, "");
    if (value === UNIFIED_DEMO_FRONTEND) {
      slugs.add(entry.name);
      continue;
    }
    if (value !== "integration") {
      throw new Error(
        `${manifestPath} declares demo_frontend: "${value}", which is not one of ` +
          `"integration" | "unified". Fix the manifest — the harness will not ` +
          `guess, because guessing "integration" here is exactly the silent ` +
          `half-migrated state this field exists to prevent.`,
      );
    }
  }
  return slugs;
}

export function loadConfig(showcaseDir: string = SHOWCASE_DIR): LocalConfig {
  // Honor LOCAL_PORTS_FILE env var (set by isolation overlay) so the harness
  // reads offset ports from a temp file instead of the checked-in original.
  const portsFile =
    process.env.LOCAL_PORTS_FILE ||
    path.join(showcaseDir, "shared/local-ports.json");
  const localPorts = JSON.parse(fs.readFileSync(portsFile, "utf-8")) as Record<
    string,
    number
  >;

  return {
    showcaseDir,
    composeFile:
      process.env.SHOWCASE_COMPOSE_FILE ||
      path.join(showcaseDir, "docker-compose.local.yml"),
    localPorts,
    pocketbase: {
      url: process.env.POCKETBASE_URL_LOCAL || "http://localhost:8090",
      // The host CLI loads no env file (showcase/.env is passed to containers
      // via compose `env_file`, never into the host process), so an isolated
      // `bin/showcase` run falls through to this default. It MUST equal the
      // superuser the PB `entrypoint.sh` actually seeds — i.e. the value of
      // POCKETBASE_SUPERUSER_EMAIL in docker-compose.local.yml:130. A fresh
      // isolated PB volume ONLY has that account; any mismatch 400s on
      // pb-auth and the d6 control plane enqueues 0 jobs. (PB 0.22+ also
      // rejects single-label hosts like `admin@localhost`, so the value must
      // carry a TLD regardless.)
      email: "admin@example.com",
      password: "showcase-local-dev",
    },
    // When --isolate offsets the aimock host port, honor env overrides so the
    // harness's host-side references point at the per-project aimock.
    aimockUrl: process.env.AIMOCK_URL_LOCAL || "http://localhost:4010",
    dashboardUrl: process.env.DASHBOARD_URL_LOCAL || "http://localhost:3210",
    dashboardPort: Number(process.env.DASHBOARD_PORT_LOCAL) || 3210,
    // 3200 is the host port `docker-compose.local.yml` publishes for
    // `frontend-nextjs` ("3200:3000"). Overridable the same way aimock /
    // dashboard are, so `--isolate` can point the harness at the per-project
    // frontend instead of the default project's.
    frontendBaseUrl: process.env.FRONTEND_URL_LOCAL || "http://localhost:3200",
    frontendPort: Number(process.env.FRONTEND_PORT_LOCAL) || 3200,
    unifiedFrontendSlugs: readUnifiedFrontendSlugs(showcaseDir),
  };
}

/**
 * The slug's OWN container origin (`http://localhost:<port>`).
 *
 * Historically this single value was fed to callers as BOTH "where the demos
 * are" and "where the agent is". It now means only the latter: the
 * integration container that hosts the slug's agent. Use `getSlugOrigins`
 * when you need either axis by name.
 */
export function getPackageUrl(slug: string, config: LocalConfig): string {
  const port = config.localPorts[slug];
  if (!port) {
    throw new Error(
      `No local port mapping for slug "${slug}". Check shared/local-ports.json.`,
    );
  }
  return `http://localhost:${port}`;
}

/**
 * The two INDEPENDENT origins a showcase cell needs.
 *
 * `demoBaseUrl` is what a browser navigates to; `agentBaseUrl` is what the
 * AG-UI runtime answers on. They are equal today for every slug and diverge
 * the moment a slug moves onto the unified frontend.
 */
export interface SlugOrigins {
  /**
   * Base URL the slug's demo pages are served from, INCLUDING any path
   * prefix. Unmigrated: `http://localhost:<port>` (no path). Migrated:
   * `<frontendBaseUrl>/<slug>`.
   *
   * The `/<slug>` prefix is baked in HERE, not injected inside a probe, so
   * no probe needs per-slug knowledge (showcase iron rule 1). It also matches
   * the fleet/discovery convention already used by
   * `LOCAL_SERVICES_JSON` (`publicUrl: http://frontend-nextjs:3000/<slug>`).
   */
  demoBaseUrl: string;
  /** Origin the slug's AGENT answers on. Always its own container. */
  agentBaseUrl: string;
  /** True when the demos are served by the unified frontend. */
  servedByUnifiedFrontend: boolean;
}

export function getSlugOrigins(slug: string, config: LocalConfig): SlugOrigins {
  const agentBaseUrl = getPackageUrl(slug, config);
  if (!config.unifiedFrontendSlugs.has(slug)) {
    // UNMIGRATED — both axes are the integration's own container, exactly as
    // before this split existed.
    return {
      demoBaseUrl: agentBaseUrl,
      agentBaseUrl,
      servedByUnifiedFrontend: false,
    };
  }
  return {
    demoBaseUrl: `${config.frontendBaseUrl.replace(/\/+$/, "")}/${slug}`,
    agentBaseUrl,
    servedByUnifiedFrontend: true,
  };
}

/**
 * The unified frontend's compose SERVICE origin. `frontend-nextjs` is the
 * service name (and therefore the compose-network DNS alias) and 3000 the
 * container port declared in `showcase/docker-compose.local.yml`, published to
 * the host as 3200:3000. Only `container_name` is rewritten per isolated
 * project, never the service name, so this alias resolves inside an
 * `--isolate` network too.
 *
 * Mirrors `UNIFIED_FRONTEND_COMPOSE_ORIGIN` in
 * `showcase/scripts/lib/manifest.ts`; this package cannot import that one.
 * `unified-frontend-sources.test.ts` pins the two together.
 */
export const UNIFIED_FRONTEND_COMPOSE_ORIGIN = "http://frontend-nextjs:3000";

/**
 * The CONTAINER-NETWORK twin of {@link getSlugOrigins}, for the roster the
 * fleet control-plane path consumes (`LOCAL_SERVICES_JSON`).
 *
 * WHY A SECOND FUNCTION AND NOT A PARAMETER. `getSlugOrigins` answers "what
 * should a browser on the HOST navigate to" and its unmigrated demo origin is
 * `http://localhost:<hostPort>`. Inside the compose network there is no
 * localhost port mapping: an integration is reached at `http://<slug>:10000`
 * and the unified app at `http://frontend-nextjs:3000`. The two functions
 * therefore share the DECISION (`unifiedFrontendSlugs`, itself derived from the
 * manifests) and nothing else. Folding them into one with a "which network"
 * flag would put two unrelated URL schemes behind one signature.
 *
 * BOTH AXES ARE RETURNED, ALWAYS. `agentBaseUrl` is the integration's own
 * container even for a migrated slug: a migration moves the DEMO PAGES onto the
 * unified app and leaves the AGENT where it was. Returning one URL for both is
 * what lets a live frontend green a cell whose agent is dead — the exact
 * false-green `getSlugOrigins` was split to prevent, and the reason
 * `control-plane-run.ts` cannot go back to emitting a single `publicUrl`.
 */
export function getSlugContainerOrigins(
  slug: string,
  config: LocalConfig,
): SlugOrigins {
  const agentBaseUrl = `http://${slug}:10000`;
  if (!config.unifiedFrontendSlugs.has(slug)) {
    return {
      demoBaseUrl: agentBaseUrl,
      agentBaseUrl,
      servedByUnifiedFrontend: false,
    };
  }
  return {
    demoBaseUrl: `${UNIFIED_FRONTEND_COMPOSE_ORIGIN}/${slug}`,
    agentBaseUrl,
    servedByUnifiedFrontend: true,
  };
}
