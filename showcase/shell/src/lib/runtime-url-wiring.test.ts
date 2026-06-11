// Wiring tests for the runtime-URL pipeline against the REAL generated
// registry — not fixtures. Two invariants that unit tests with synthetic
// data cannot catch:
//
// 1. The framework-slug set middleware derives from registry.json must be
//    non-empty. An empty set (schema drift, generator regression) would
//    silently disable every framework-scoped docs 301 — requests would
//    fall through to the SEO redirect table instead.
// 2. The SSR placeholder config (runtime-config.client.ts) composed with
//    backendUrlFromPattern must yield a parseable, RFC-2606-unresolvable
//    URL for a real registry slug — `new URL()` in consumers must not
//    throw during SSR.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { backendUrlFromPattern } from "./backend-url";
import { getRuntimeConfig as getClientRuntimeConfig } from "./runtime-config.client";
import { REGISTRY_FRAMEWORK_SLUGS } from "../middleware";

const SHELL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REGISTRY_PATH = path.join(SHELL_ROOT, "src", "data", "registry.json");

interface RegistryShape {
  integrations?: { slug: string }[];
}

let registry: RegistryShape;

beforeAll(() => {
  // registry.json is a generated, gitignored artifact (see
  // showcase/.gitignore). The vitest globalSetup (vitest.global-setup.ts)
  // generates it before any worker starts — if this assert fires, the
  // setup didn't run (or wrote somewhere unexpected).
  expect(
    fs.existsSync(REGISTRY_PATH),
    `registry.json missing at ${REGISTRY_PATH} — vitest.global-setup.ts should have generated it`,
  ).toBe(true);
  registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as RegistryShape;
});

describe("registry framework slugs (real registry.json)", () => {
  it("derives a non-empty slug set (middleware docs-301 precondition)", () => {
    // Assert the PRODUCTION value — the actual Set middleware builds at
    // module load from registry.json — not a re-implementation of the
    // derivation that could drift out of sync.
    expect(REGISTRY_FRAMEWORK_SLUGS.size).toBeGreaterThan(0);
    for (const slug of REGISTRY_FRAMEWORK_SLUGS) {
      expect(typeof slug).toBe("string");
      expect(slug.length).toBeGreaterThan(0);
    }
    // And it must reflect the real artifact 1:1.
    const fromFile = new Set((registry.integrations ?? []).map((i) => i.slug));
    expect(REGISTRY_FRAMEWORK_SLUGS).toEqual(fromFile);
  });
});

describe("SSR placeholder composed with backendUrlFromPattern", () => {
  it("produces a parseable .invalid URL for a real registry slug", () => {
    const slug = registry.integrations?.[0]?.slug;
    expect(slug).toBeTruthy();

    // Simulate the SSR phase: no `window`, so the client reader returns
    // the placeholder config rather than throwing. stubGlobal (not
    // delete/reassign) so vitest restores the original even if an
    // assertion throws mid-test.
    vi.stubGlobal("window", undefined);
    try {
      const cfg = getClientRuntimeConfig();
      const url = backendUrlFromPattern(cfg.backendHostPattern, slug!);
      // Parseable (consumers may `new URL()` it inline during SSR) and
      // unresolvable (.invalid is RFC-2606 reserved — no real fetch).
      expect(() => new URL(url)).not.toThrow();
      expect(url).toBe(`https://showcase-${slug}.ssr-placeholder.invalid`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
