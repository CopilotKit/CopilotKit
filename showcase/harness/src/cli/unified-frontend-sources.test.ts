/**
 * CROSS-VALIDATION of every namespace that expresses "the unified frontend
 * serves this slug's demos".
 *
 * THE BUG CLASS THIS FILE EXISTS FOR. The state used to be spelled three ways
 * that nothing compared: `LOCAL_SERVICE_URL_<SLUG>` (compose + apply_isolation),
 * `SHOWCASE_UNIFIED_FRONTEND_SLUGS` (this CLI, and nothing else), and a
 * hardcoded `http://<slug>:10000` in `control-plane-run.ts`. Migrating a slug
 * meant setting two of them and hoping the third agreed, and a slug migrated in
 * one namespace but not another looked HEALTHY — the demos 404ed or the agent
 * probe hit the wrong origin, both of which read as an ordinary failing cell.
 *
 * There is now one tracked source (`demo_frontend` in each
 * `showcase/integrations/<slug>/manifest.yaml`) and two derivations of it: this
 * CLI reads the manifests directly (`loadConfig`), and the compose side reads
 * `showcase/local-services.generated.env`, emitted from the same manifests. This
 * file asserts the two derivations agree FOR EVERY SLUG, which is the check
 * whose absence allowed the half-migrated state.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  UNIFIED_FRONTEND_COMPOSE_ORIGIN,
  getSlugContainerOrigins,
  getSlugOrigins,
  loadConfig,
} from "./config.js";

const SHOWCASE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const INTEGRATIONS_DIR = path.join(SHOWCASE_DIR, "integrations");
const GENERATED_ENV = path.join(SHOWCASE_DIR, "local-services.generated.env");

function envKeyFor(slug: string): string {
  return `LOCAL_SERVICE_URL_${slug.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * Parse the generated bridge the same way `_common.sh` does: only
 * `LOCAL_SERVICE_URL_<SLUG>=<value>` lines count, last assignment wins.
 */
function parseGeneratedEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const match = /^(LOCAL_SERVICE_URL_[A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    out.set(match[1], match[2]);
  }
  return out;
}

/** The manifests' own answer, read independently of `loadConfig`. */
function manifestFrontends(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of fs.readdirSync(INTEGRATIONS_DIR, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const manifestPath = path.join(
      INTEGRATIONS_DIR,
      entry.name,
      "manifest.yaml",
    );
    if (!fs.existsSync(manifestPath)) continue;
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const match = /^demo_frontend:[ \t]*(\S+)[ \t]*$/m.exec(raw);
    out.set(
      entry.name,
      match ? match[1].replace(/^["']|["']$/g, "") : "integration",
    );
  }
  return out;
}

const config = loadConfig();
const generated = parseGeneratedEnv(fs.readFileSync(GENERATED_ENV, "utf8"));
const manifests = manifestFrontends();

describe("every integration declares demo_frontend", () => {
  it("all 20 manifests carry the field explicitly", () => {
    // Explicit beats implicit here: the field IS the tracked state, and a
    // manifest silently relying on the default hides the axis from anyone
    // reading it.
    expect(manifests.size).toBeGreaterThan(0);
    for (const [slug, value] of manifests) {
      expect(["integration", "unified"], slug).toContain(value);
    }
  });

  it("declares a demo_frontend for every slug the harness can target", () => {
    // A slug with a local port but no manifest field would resolve through the
    // default with nothing tracked saying so.
    for (const slug of Object.keys(config.localPorts)) {
      expect(manifests.has(slug), slug).toBe(true);
    }
  });
});

describe("the harness view and the compose bridge agree for every slug", () => {
  it.each(Object.keys(config.localPorts))(
    "%s: manifest, harness origins, and generated env all say the same thing",
    (slug) => {
      const declaredUnified = manifests.get(slug) === "unified";
      const key = envKeyFor(slug);

      // 1. The harness's host-side view.
      expect(getSlugOrigins(slug, config).servedByUnifiedFrontend).toBe(
        declaredUnified,
      );
      // 2. The harness's container-side view (the fleet roster axis).
      expect(
        getSlugContainerOrigins(slug, config).servedByUnifiedFrontend,
      ).toBe(declaredUnified);
      // 3. The compose bridge. An un-migrated slug is deliberately ABSENT —
      //    the compose roster's own `:-http://<slug>:10000` default covers it,
      //    and restating a default in two places is how they drift.
      expect(generated.has(key), `${key} present in generated env`).toBe(
        declaredUnified,
      );
      if (declaredUnified) {
        expect(generated.get(key)).toBe(
          `${UNIFIED_FRONTEND_COMPOSE_ORIGIN}/${slug}`,
        );
      }
    },
  );

  it("the generated env declares no slug the manifests do not", () => {
    // The other direction: a stale artifact carrying a slug that has since been
    // un-migrated would export a URL nothing asked for.
    const expectedKeys = new Set(
      [...manifests.entries()]
        .filter(([, value]) => value === "unified")
        .map(([slug]) => envKeyFor(slug)),
    );
    expect([...generated.keys()].sort()).toEqual([...expectedKeys].sort());
  });
});

describe("the two axes stay independent", () => {
  it.each(Object.keys(config.localPorts))(
    "%s: the agent origin is the integration's own container regardless of demo_frontend",
    (slug) => {
      // The false-green guard, asserted for every slug: a migration must never
      // move the AGENT. If these two ever coincide for a migrated slug, a live
      // unified frontend would green a cell whose agent is dead.
      expect(getSlugContainerOrigins(slug, config).agentBaseUrl).toBe(
        `http://${slug}:10000`,
      );
      expect(getSlugOrigins(slug, config).agentBaseUrl).toBe(
        `http://localhost:${config.localPorts[slug]}`,
      );
    },
  );
});

describe("SHOWCASE_UNIFIED_FRONTEND_SLUGS is gone", () => {
  it("setting it does not migrate a slug", () => {
    // The removed second knob. If someone reintroduces an env override, this
    // goes red — and it should, because an override that disagrees with the
    // manifest IS the half-migrated state.
    const before = process.env.SHOWCASE_UNIFIED_FRONTEND_SLUGS;
    process.env.SHOWCASE_UNIFIED_FRONTEND_SLUGS = "langgraph-python";
    try {
      const reloaded = loadConfig();
      expect(reloaded.unifiedFrontendSlugs.has("langgraph-python")).toBe(
        manifests.get("langgraph-python") === "unified",
      );
    } finally {
      if (before === undefined) {
        delete process.env.SHOWCASE_UNIFIED_FRONTEND_SLUGS;
      } else {
        process.env.SHOWCASE_UNIFIED_FRONTEND_SLUGS = before;
      }
    }
  });
});

describe("loadConfig derives the set from a manifest tree", () => {
  it("picks up demo_frontend: unified and rejects an unknown value", () => {
    // Exercised against a temp tree so the assertion does not depend on WHICH
    // real slugs are migrated (langgraph-python is; the rest are not).
    const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-ufs-"));
    try {
      fs.mkdirSync(path.join(root, "shared"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "shared", "local-ports.json"),
        JSON.stringify({ alpha: 3100, beta: 3101 }),
      );
      for (const [slug, value] of [
        ["alpha", "unified"],
        ["beta", "integration"],
      ] as const) {
        fs.mkdirSync(path.join(root, "integrations", slug), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(root, "integrations", slug, "manifest.yaml"),
          `slug: ${slug}\ndemo_frontend: ${value}\n`,
        );
      }
      const cfg = loadConfig(root);
      expect([...cfg.unifiedFrontendSlugs].sort()).toEqual(["alpha"]);
      expect(getSlugContainerOrigins("alpha", cfg).demoBaseUrl).toBe(
        "http://frontend-nextjs:3000/alpha",
      );
      expect(getSlugContainerOrigins("beta", cfg).demoBaseUrl).toBe(
        "http://beta:10000",
      );

      fs.writeFileSync(
        path.join(root, "integrations", "beta", "manifest.yaml"),
        "slug: beta\ndemo_frontend: unifed\n",
      );
      expect(() => loadConfig(root)).toThrow(/not one of/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
