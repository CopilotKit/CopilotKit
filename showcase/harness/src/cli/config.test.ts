import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { loadConfig, getPackageUrl, getSlugOrigins } from "./config.js";
import type { LocalConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// showcase/harness/src/cli -> showcase
const SHOWCASE_DIR = path.resolve(__dirname, "../../..");
const COMPOSE_FILE = path.join(SHOWCASE_DIR, "docker-compose.local.yml");

/**
 * Read the superuser email the PocketBase service is seeded with in
 * docker-compose.local.yml. The PB `entrypoint.sh` creates exactly this
 * superuser, so it is the single source of truth for the credential the
 * host CLI must authenticate as. A fresh isolated PB volume ONLY has this
 * account — if the host default disagrees the pb-auth login 400s and the
 * d6 control plane enqueues 0 jobs.
 */
function composeSeededSuperuserEmail(): string {
  const doc = yaml.load(fs.readFileSync(COMPOSE_FILE, "utf-8")) as {
    services: Record<string, { environment?: string[] }>;
  };
  const env = doc.services.pocketbase.environment ?? [];
  const entry = env.find((e) => e.startsWith("POCKETBASE_SUPERUSER_EMAIL="));
  if (!entry) {
    throw new Error(
      "POCKETBASE_SUPERUSER_EMAIL not set on the pocketbase service in docker-compose.local.yml",
    );
  }
  return entry.slice("POCKETBASE_SUPERUSER_EMAIL=".length);
}

describe("loadConfig() — PocketBase superuser default", () => {
  const SUPERUSER_ENV_KEYS = [
    "POCKETBASE_SUPERUSER_EMAIL",
    "POCKETBASE_SUPERUSER_PASSWORD",
    "POCKETBASE_URL_LOCAL",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Clear superuser env so we exercise the hardcoded config default — the
    // host shell does NOT load showcase/.env (compose passes it to containers
    // only), so an isolated `bin/showcase` run falls through to this default.
    for (const key of SUPERUSER_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of SUPERUSER_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults the superuser email to the value docker-compose.local.yml seeds", () => {
    // Single source of truth: docker-compose.local.yml:130
    // POCKETBASE_SUPERUSER_EMAIL. The host CLI default MUST match the
    // compose-seeded superuser or isolated PB volumes 400 on pb-auth.
    const expected = composeSeededSuperuserEmail();
    expect(loadConfig().pocketbase.email).toBe(expected);
  });
});

/**
 * Read the HOST port `docker-compose.local.yml` publishes for the unified
 * frontend (`"3200:3000"`). Single source of truth for the harness default —
 * if the two disagree, `bin/showcase up` health-gates the wrong port and
 * either hangs or crosses onto a foreign container.
 */
function composeFrontendHostPort(): number {
  const doc = yaml.load(fs.readFileSync(COMPOSE_FILE, "utf-8")) as {
    services: Record<string, { ports?: string[] }>;
  };
  const ports = doc.services["frontend-nextjs"]?.ports ?? [];
  const mapping = ports.find((p) => p.endsWith(":3000"));
  if (!mapping) {
    throw new Error(
      "frontend-nextjs publishes no host port mapping to container :3000 in docker-compose.local.yml",
    );
  }
  return Number(mapping.split(":")[0]);
}

describe("loadConfig() — unified frontend", () => {
  const FRONTEND_ENV_KEYS = [
    "FRONTEND_URL_LOCAL",
    "FRONTEND_PORT_LOCAL",
    "SHOWCASE_UNIFIED_FRONTEND_SLUGS",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of FRONTEND_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of FRONTEND_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults frontendPort to the host port docker-compose.local.yml publishes", () => {
    expect(loadConfig().frontendPort).toBe(composeFrontendHostPort());
  });

  it("defaults frontendBaseUrl to localhost on that same port", () => {
    const port = composeFrontendHostPort();
    expect(loadConfig().frontendBaseUrl).toBe(`http://localhost:${port}`);
  });

  it("treats EXACTLY the migrated slugs as migrated, read from the real manifests", () => {
    // Derived from the real manifests, not from configuration.
    //
    // THIS IS THE THIRD PER-SLUG PIN of the migrated roster, alongside
    // showcase/scripts/__tests__/emit-local-services-env.test.ts and
    // showcase/scripts/lib/__tests__/manifest.test.ts. All three must be
    // updated together, and only after the new slug's migration has been
    // verified LIVE with a full D6 matrix through the default fleet path
    // (`bash bin/showcase test <slug> --d6 --verbose`, NOT `--direct`) both
    // before and after the flip.
    //
    // It used to assert `size === 0` ("nothing is migrated in tracked form").
    // That statement stopped being true the moment langgraph-python migrated,
    // and because it was phrased as a bare count instead of a per-slug pin it
    // went red without naming what changed. Keep it per-slug.
    expect([...loadConfig().unifiedFrontendSlugs].sort()).toEqual([
      "ag2",
      "agno",
      "built-in-agent",
      "claude-sdk-python",
      "claude-sdk-typescript",
      "crewai-crews",
      "google-adk",
      "langgraph-fastapi",
      "langgraph-python",
      "langgraph-typescript",
      "langroid",
      "llamaindex",
      "mastra",
      "ms-agent-dotnet",
      "ms-agent-harness-dotnet",
      "ms-agent-python",
      "pydantic-ai",
      "spring-ai",
      "strands",
      "strands-typescript",
    ]);
  });

  it("IGNORES SHOWCASE_UNIFIED_FRONTEND_SLUGS — the env knob was removed", () => {
    // This used to be the ONLY reader of that variable, and the only expression
    // of the migration the compose side could not see. Keeping it as an
    // "override" would preserve the exact half-migrated state the manifest field
    // exists to prevent: an override that disagrees with the manifest. The
    // migration procedure is now "edit the manifest, run the emitter".
    //
    // Asserted as "the set does not change", NOT as a count: the point is that
    // the variable has no effect, and naming slugs it must never introduce
    // (ghost-slug, not-a-real-integration) keeps that meaning readable as the
    // real roster grows. The last three integration-frontend slugs
    // (crewai-crews, langroid, llamaindex) are now migrated — do not use
    // them as a "must never appear" example.
    const before = [...loadConfig().unifiedFrontendSlugs].sort();
    process.env.SHOWCASE_UNIFIED_FRONTEND_SLUGS =
      "mastra, ghost-slug  not-a-real-integration";
    const after = [...loadConfig().unifiedFrontendSlugs].sort();
    expect(after).toEqual(before);
    expect(after).not.toContain("ghost-slug");
    expect(after).not.toContain("not-a-real-integration");
  });

  it("honours FRONTEND_URL_LOCAL so --isolate can re-point the frontend", () => {
    process.env.FRONTEND_URL_LOCAL = "http://localhost:3250";
    expect(loadConfig().frontendBaseUrl).toBe("http://localhost:3250");
  });
});

// ---------------------------------------------------------------------------
// getSlugOrigins — the two axes
// ---------------------------------------------------------------------------

function stubConfig(overrides: Partial<LocalConfig> = {}): LocalConfig {
  return {
    showcaseDir: "/tmp/showcase",
    composeFile: "/tmp/docker-compose.local.yml",
    localPorts: { mastra: 3105, "langgraph-python": 3100 },
    pocketbase: {
      url: "http://localhost:8090",
      email: "admin@example.com",
      password: "showcase-local-dev",
    },
    aimockUrl: "http://localhost:4010",
    dashboardUrl: "http://localhost:3210",
    dashboardPort: 3210,
    frontendBaseUrl: "http://localhost:3200",
    frontendPort: 3200,
    unifiedFrontendSlugs: new Set<string>(),
    ...overrides,
  };
}

describe("getSlugOrigins() — where the demos are vs where the agent is", () => {
  it("UNMIGRATED slug: both axes are the slug's own container, byte-identical to getPackageUrl", () => {
    // BACK-COMPAT PROOF for task 2. Every slug in the tree is in this state,
    // so this pins the exact string the single-value implementation returned.
    const config = stubConfig();
    const origins = getSlugOrigins("langgraph-python", config);
    expect(origins.demoBaseUrl).toBe("http://localhost:3100");
    expect(origins.agentBaseUrl).toBe("http://localhost:3100");
    expect(origins.demoBaseUrl).toBe(getPackageUrl("langgraph-python", config));
    expect(origins.servedByUnifiedFrontend).toBe(false);
  });

  it("MIGRATED slug: demos move to the frontend under /<slug>; the AGENT does not move", () => {
    const config = stubConfig({
      unifiedFrontendSlugs: new Set(["mastra"]),
    });
    const origins = getSlugOrigins("mastra", config);
    expect(origins.demoBaseUrl).toBe("http://localhost:3200/mastra");
    // The agent stays on its own container — this is the axis that a single
    // value could not express.
    expect(origins.agentBaseUrl).toBe("http://localhost:3105");
    expect(origins.servedByUnifiedFrontend).toBe(true);
    expect(origins.demoBaseUrl).not.toBe(origins.agentBaseUrl);
  });

  it("migrating ONE slug leaves every other slug untouched", () => {
    const config = stubConfig({
      unifiedFrontendSlugs: new Set(["mastra"]),
    });
    const other = getSlugOrigins("langgraph-python", config);
    expect(other.demoBaseUrl).toBe("http://localhost:3100");
    expect(other.agentBaseUrl).toBe("http://localhost:3100");
  });

  it("does not double up slashes when frontendBaseUrl carries a trailing slash", () => {
    const config = stubConfig({
      frontendBaseUrl: "http://localhost:3200/",
      unifiedFrontendSlugs: new Set(["mastra"]),
    });
    expect(getSlugOrigins("mastra", config).demoBaseUrl).toBe(
      "http://localhost:3200/mastra",
    );
  });

  it("throws for a slug with no local port mapping, migrated or not", () => {
    // A migrated slug still needs its agent port — resolving the demo origin
    // must not paper over a missing local-ports.json entry.
    const config = stubConfig({
      unifiedFrontendSlugs: new Set(["ghost"]),
    });
    expect(() => getSlugOrigins("ghost", config)).toThrow(
      /No local port mapping/,
    );
  });
});
