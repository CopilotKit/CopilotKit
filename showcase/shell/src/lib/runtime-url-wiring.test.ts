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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { backendUrlFromPattern } from "./backend-url";
import { getRuntimeConfig as getClientRuntimeConfig } from "./runtime-config.client";

// Imported dynamically in beforeAll AFTER spying console.warn:
// middleware emits its module-load table warns (duplicate
// exact/wildcard sources) at import time, and a static import would
// land them raw in the test output whenever this file is the first in
// its worker to load the module.
let REGISTRY_FRAMEWORK_SLUGS: ReadonlySet<string>;

const SHELL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REGISTRY_PATH = path.join(SHELL_ROOT, "src", "data", "registry.json");

interface RegistryShape {
  // `slug` typed as unknown, not string: this test reads the REAL
  // generated artifact, and the comparison below must mirror
  // middleware's drop semantics for malformed entries rather than
  // assume the happy shape.
  integrations?: { slug?: unknown }[];
}

let registry: RegistryShape;

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  ({ REGISTRY_FRAMEWORK_SLUGS } = await import("../middleware"));
  // registry.json is a generated, gitignored artifact (see
  // showcase/.gitignore). The vitest globalSetup (vitest.global-setup.ts)
  // generates it before any worker starts — if this assert fires, the
  // setup didn't run (or wrote somewhere unexpected).
  expect(
    fs.existsSync(REGISTRY_PATH),
    `registry.json missing at ${REGISTRY_PATH} — vitest.global-setup.ts should have generated it`,
  ).toBe(true);
  registry = JSON.parse(
    fs.readFileSync(REGISTRY_PATH, "utf8"),
  ) as RegistryShape;
});

afterAll(() => {
  vi.restoreAllMocks();
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
    // And it must reflect the real artifact 1:1 — modulo middleware's
    // construction-time lowercasing (SU4-A4): compare against the
    // LOWERCASED file slugs (SU5-A6), or a future mixed-case registry
    // slug fails this wiring test even though middleware handles it.
    // The re-derivation mirrors extractFrameworkSlugs' DROP semantics
    // (SU6-B6): entries with a missing or non-string slug are skipped,
    // not dereferenced — the previous `i.slug.toLowerCase()` would
    // TypeError on a malformed entry that middleware merely drops,
    // turning a meaningful set-diff failure into an unrelated crash.
    const fromFile = new Set(
      (registry.integrations ?? [])
        .map((i) => i.slug)
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.toLowerCase()),
    );
    expect(REGISTRY_FRAMEWORK_SLUGS).toEqual(fromFile);
  });
});

describe("SSR placeholder composed with backendUrlFromPattern", () => {
  it("produces a parseable .invalid URL for a real registry slug", () => {
    const slug = registry.integrations?.[0]?.slug;
    // Hard narrow (not a bare truthiness expect): slug is `unknown` in
    // RegistryShape, and the substitution below needs a real string.
    if (typeof slug !== "string" || slug.length === 0) {
      throw new Error(
        "registry.json's first integration carries no string slug — " +
          "the generated artifact is malformed",
      );
    }

    // Simulate the SSR phase: no `window`, so the client reader returns
    // the placeholder config rather than throwing. stubGlobal (not
    // delete/reassign) so vitest restores the original even if an
    // assertion throws mid-test.
    vi.stubGlobal("window", undefined);
    try {
      const cfg = getClientRuntimeConfig();
      const url = backendUrlFromPattern(cfg.backendHostPattern, slug);
      // Parseable (consumers may `new URL()` it inline during SSR) and
      // unresolvable (.invalid is RFC-2606 reserved — no real fetch).
      expect(() => new URL(url)).not.toThrow();
      expect(url).toBe(`https://showcase-${slug}.ssr-placeholder.invalid`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
