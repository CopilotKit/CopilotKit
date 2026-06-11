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
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { backendUrlFromPattern } from "./backend-url";
import { getRuntimeConfig as getClientRuntimeConfig } from "./runtime-config.client";

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
  // showcase/.gitignore). On a fresh checkout it doesn't exist yet —
  // generate it the same way `npm run dev`/`build` do so this suite is
  // runnable standalone. Generous timeout: the generator validates every
  // manifest and emits catalogs for all shells.
  if (!fs.existsSync(REGISTRY_PATH)) {
    execFileSync("npx", ["tsx", "../scripts/generate-registry.ts"], {
      cwd: SHELL_ROOT,
      stdio: "ignore",
    });
  }
  registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as unknown as RegistryShape;
}, 120_000);

describe("registry framework slugs (real registry.json)", () => {
  it("derives a non-empty slug set (middleware docs-301 precondition)", () => {
    // Same derivation expression as REGISTRY_FRAMEWORK_SLUGS in
    // src/middleware.ts — keep in sync.
    const slugs = new Set(
      (registry.integrations ?? []).map((i) => i.slug),
    );
    expect(slugs.size).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(typeof slug).toBe("string");
      expect(slug.length).toBeGreaterThan(0);
    }
  });
});

describe("SSR placeholder composed with backendUrlFromPattern", () => {
  it("produces a parseable .invalid URL for a real registry slug", () => {
    const slug = registry.integrations?.[0]?.slug;
    expect(slug).toBeTruthy();

    // Simulate the SSR phase: no `window`, so the client reader returns
    // the placeholder config rather than throwing.
    const w = globalThis.window;
    // @ts-expect-error — deliberately removing window for the test
    delete globalThis.window;
    try {
      const cfg = getClientRuntimeConfig();
      const url = backendUrlFromPattern(cfg.backendHostPattern, slug!);
      // Parseable (consumers may `new URL()` it inline during SSR) and
      // unresolvable (.invalid is RFC-2606 reserved — no real fetch).
      expect(() => new URL(url)).not.toThrow();
      expect(url).toBe(`https://showcase-${slug}.ssr-placeholder.invalid`);
    } finally {
      (globalThis as { window?: typeof w }).window = w;
    }
  });
});
