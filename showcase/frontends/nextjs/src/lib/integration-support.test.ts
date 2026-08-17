import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { parse } from "yaml";

import {
  classifyDemoPathname,
  getIntegration,
  INTEGRATIONS_DIR_ENV,
  interruptHookForPattern,
  listAllDemoIds,
  listIntegrations,
  MANIFEST_FAILURE_TTL_MS,
  ManifestLoadError,
  resetIntegrationsCacheForTests,
  resolveDemoSupport,
  resolveInterruptPattern,
} from "./integration-support";
import type { IntegrationManifest } from "./integration-support";

const FIXTURES: IntegrationManifest[] = [
  {
    name: "LangGraph (Python)",
    slug: "langgraph-python",
    features: ["agentic-chat", "mcp-apps", "gen-ui-interrupt"],
    not_supported_features: ["gen-ui-interrupt"],
    demos: [
      {
        id: "agentic-chat",
        name: "Agentic Chat",
        route: "/demos/agentic-chat",
      },
      { id: "mcp-apps", name: "MCP Apps", route: "/demos/mcp-apps" },
      {
        id: "gen-ui-interrupt",
        name: "Gen UI Interrupt",
        route: "/demos/gen-ui-interrupt",
      },
    ],
  },
  {
    name: "Spring AI",
    slug: "spring-ai",
    features: ["agentic-chat"],
    demos: [
      {
        id: "agentic-chat",
        name: "Agentic Chat",
        route: "/demos/agentic-chat",
      },
    ],
  },
  /**
   * Drift, on purpose: `mcp-apps` is under `features` with no `demos[]` row.
   * Nine real integrations shipped this shape, and it is not a synthetic
   * concern — `shared-state-read` had a static page segment, so the guard
   * passed, the real chat UI rendered, and every message 404ed against the API.
   */
  {
    name: "Drifted",
    slug: "drifted",
    features: ["agentic-chat", "mcp-apps"],
    demos: [
      {
        id: "agentic-chat",
        name: "Agentic Chat",
        route: "/demos/agentic-chat",
      },
    ],
  },
];

describe("resolveInterruptPattern", () => {
  it("routes promise-based manifests to useHumanInTheLoop", () => {
    expect(
      resolveInterruptPattern({ interrupt_pattern: "promise-based" }),
    ).toBe("promise-based");
    expect(interruptHookForPattern("promise-based")).toBe("useHumanInTheLoop");
  });

  it("routes native manifests to useInterrupt", () => {
    expect(resolveInterruptPattern({ interrupt_pattern: "native" })).toBe(
      "native",
    );
    expect(interruptHookForPattern("native")).toBe("useInterrupt");
  });

  it("treats a missing field as native (LangGraph default)", () => {
    expect(resolveInterruptPattern({})).toBe("native");
    expect(resolveInterruptPattern(undefined)).toBe("native");
    expect(interruptHookForPattern("native")).toBe("useInterrupt");
  });

  it("treats an unknown value as native", () => {
    expect(resolveInterruptPattern({ interrupt_pattern: "other" })).toBe(
      "native",
    );
  });
});

describe("resolveDemoSupport", () => {
  it("marks a demo listed in features as supported", () => {
    const support = resolveDemoSupport(
      "langgraph-python",
      "mcp-apps",
      FIXTURES,
    );
    expect(support.kind).toBe("supported");
  });

  it("marks a union demo the backend never declares as not-supported", () => {
    // /spring-ai/demos/mcp-apps — structurally valid, no backend.
    const support = resolveDemoSupport("spring-ai", "mcp-apps", FIXTURES);
    expect(support.kind).toBe("not-supported");
    expect(support.kind === "not-supported" && support.reason).toContain(
      "Spring AI",
    );
  });

  it("lets not_supported_features override features", () => {
    const support = resolveDemoSupport(
      "langgraph-python",
      "gen-ui-interrupt",
      FIXTURES,
    );
    expect(support.kind).toBe("not-supported");
  });

  it("refuses to call a features id with no demos[] row supported", () => {
    // THE MECHANISM FIX: this function is the one authority both the page tree
    // and the API routes ask. While only the API rejected a missing row, the
    // two disagreed — and the observable shape of that disagreement is a
    // rendered chat UI whose every message 404s.
    const support = resolveDemoSupport("drifted", "mcp-apps", FIXTURES);
    expect(support.kind).toBe("not-supported");
    const reason = support.kind === "not-supported" ? support.reason : "";
    expect(reason).toMatch(/Manifest drift/);
    expect(reason).toContain("mcp-apps");
    // Names the repair, both ways round.
    expect(reason).toContain("manifest.yaml");
    expect(reason).toContain("features");
  });

  it("still calls an id WITH a demos[] row supported", () => {
    expect(resolveDemoSupport("drifted", "agentic-chat", FIXTURES).kind).toBe(
      "supported",
    );
  });

  it("reports an unknown integration as malformed", () => {
    expect(resolveDemoSupport("nope", "agentic-chat", FIXTURES).kind).toBe(
      "malformed",
    );
  });

  it("reports a demo id no integration declares as malformed", () => {
    expect(resolveDemoSupport("spring-ai", "nope", FIXTURES).kind).toBe(
      "malformed",
    );
  });

  it("never resolves to a 404 signal", () => {
    for (const slug of ["langgraph-python", "spring-ai", "nope"]) {
      for (const demo of ["agentic-chat", "mcp-apps", "nope"]) {
        const support = resolveDemoSupport(slug, demo, FIXTURES);
        expect([
          "supported",
          "not-supported",
          "informational",
          "malformed",
        ]).toContain(support.kind);
      }
    }
  });

  /**
   * INFORMATIONAL rows. `cli-start` is a copy-paste `npx copilotkit@latest
   * init …` command: listed under `features`, carrying a `demos[]` row, and
   * describing nothing runnable (no `route`, no `agent`).
   *
   * The rule used to live ONLY in `agent-resolution.ts`, so the three readers
   * of one row said three different things: the index called it SUPPORTED and
   * linked it; the demo page said "…but this frontend does not carry the demo
   * page yet" (false — it is never meant to have one); and the API 404ed it as
   * `malformed`. That is exactly the disagreement `resolveDemoSupport`'s
   * docstring says it exists to prevent.
   */
  const INFORMATIONAL: IntegrationManifest[] = [
    {
      name: "Agno",
      slug: "agno",
      features: ["agentic-chat", "cli-start", "subagents"],
      demos: [
        { id: "agentic-chat", name: "Chat", route: "/demos/agentic-chat" },
        { id: "cli-start", name: "CLI Start Command", command: "npx cpk init" },
        // No route, but it DOES name an agent: servable, so not informational.
        { id: "subagents", name: "Subagents", agent: { path: "/subagents" } },
      ],
    },
  ];

  it("resolves a command-only row as informational, not supported", () => {
    const support = resolveDemoSupport("agno", "cli-start", INFORMATIONAL);
    expect(support.kind).toBe("informational");
    if (support.kind !== "informational") return;
    expect(support.command).toBe("npx cpk init");
    expect(support.reason).toContain("informational");
    expect(support.reason).toContain("cli-start");
    // It must NOT read as a gap in the backend: that is the false claim.
    expect(support.reason).not.toMatch(/does not provide a backend/);
    expect(support.reason).not.toMatch(/does not carry the demo page/);
  });

  it("still calls a row that names an agent supported, even with no route", () => {
    // The `!route && !agent` test is deliberate: a demo that names an agent is
    // servable even when its page is missing, and that deserves the ordinary
    // agent error rather than the informational arm.
    expect(resolveDemoSupport("agno", "subagents", INFORMATIONAL).kind).toBe(
      "supported",
    );
  });

  it("carries the cell facts on the informational arm", () => {
    // The arm is rendered by `CellUnavailable`, which prints slug/demo id,
    // backend name and feature name — so it must carry them like
    // `not-supported` does, not degrade to a bare `reason` like `malformed`.
    const support = resolveDemoSupport("agno", "cli-start", INFORMATIONAL);
    if (support.kind !== "informational") throw new Error("wrong kind");
    expect(support.slug).toBe("agno");
    expect(support.integrationName).toBe("Agno");
    expect(support.demoId).toBe("cli-start");
    expect(support.demoName).toBe("CLI Start Command");
  });
});

describe("classifyDemoPathname", () => {
  it("extracts the demo id from a demo route", () => {
    expect(
      classifyDemoPathname("/spring-ai/demos/mcp-apps", "spring-ai"),
    ).toEqual({ kind: "demo", demoId: "mcp-apps" });
  });

  it("NORMALISES exactly one trailing slash, parsing it identically", () => {
    // A single trailing slash names the SAME route under either `trailingSlash`
    // setting: the default `false` redirects `/x/` to `/x`, and `true` makes
    // `/x/` the canonical spelling and redirects the other way. Normalising is
    // therefore the only handling that is correct without knowing the setting.
    // Tolerating it leans on `false`; REJECTING it leans on `false` just as
    // hard, except that it then fails closed on every demo of every integration
    // instead of on none of them. SAME PARSE, not merely "also accepted", is the
    // property that makes the coupling gone rather than inverted.
    const canonical = classifyDemoPathname(
      "/mastra/demos/agentic-chat",
      "mastra",
    );
    expect(canonical).toEqual({ kind: "demo", demoId: "agentic-chat" });
    expect(
      classifyDemoPathname("/mastra/demos/agentic-chat/", "mastra"),
    ).toEqual(canonical);

    // ...and the same for the index, where the trailing slash follows `demos`.
    expect(classifyDemoPathname("/mastra/demos/", "mastra")).toEqual(
      classifyDemoPathname("/mastra/demos", "mastra"),
    );
  });

  it.each([
    ["a doubled slash mid-path", "/mastra//demos/agentic-chat"],
    ["a REPEATED trailing slash", "/mastra/demos/agentic-chat//"],
    ["several doubled slashes", "/mastra//demos///agentic-chat"],
    ["a lone slash carrying no segments", "/"],
  ])(
    "still rejects %s — ONE trailing slash is normalised, never a loop",
    (_label, pathname) => {
      // Next.js does not route any of these the way it routes the canonical
      // form, so collapsing them — which `filter(Boolean)` did — would have the
      // guard reason about a different request than the one being served.
      const route = classifyDemoPathname(pathname, "mastra");
      expect(route.kind).toBe("malformed");
      expect(route.kind === "malformed" && route.reason).toContain(
        "empty path segment",
      );
    },
  );

  it("rejects a pathname that is not absolute, naming that as the fault", () => {
    // `x-pathname` is a header, so a relative value is reachable — and
    // `filter(Boolean)` made it indistinguishable from the absolute form.
    const route = classifyDemoPathname("mastra/demos/agentic-chat", "mastra");
    expect(route.kind).toBe("malformed");
    expect(route.kind === "malformed" && route.reason).toContain(
      "not an absolute pathname",
    );
  });

  it("decodes a percent-encoded segment", () => {
    expect(
      classifyDemoPathname("/spring-ai/demos/mcp%2Dapps", "spring-ai"),
    ).toEqual({ kind: "demo", demoId: "mcp-apps" });
  });

  it("reports a malformed escape as malformed, not as a pass-through", () => {
    const route = classifyDemoPathname(
      "/spring-ai/demos/%E0%A4%A",
      "spring-ai",
    );
    expect(route.kind).toBe("malformed");
  });

  it("passes the demos index through", () => {
    // Both spellings, because one trailing slash is normalised away.
    expect(classifyDemoPathname("/spring-ai/demos", "spring-ai")).toEqual({
      kind: "demos-index",
    });
    expect(classifyDemoPathname("/spring-ai/demos/", "spring-ai")).toEqual({
      kind: "demos-index",
    });
  });

  it("reports a deeper demo path as malformed, never as 'not my route'", () => {
    // A pass-through here would render the child page with the guard
    // skipped, which is a guard bypass, not a miss.
    const route = classifyDemoPathname(
      "/spring-ai/demos/mcp-apps/extra",
      "spring-ai",
    );
    expect(route.kind).toBe("malformed");
    expect(route.kind === "malformed" && route.reason).toContain(
      "/spring-ai/demos/mcp-apps/extra",
    );
  });

  it("reports a basePath-shifted path as malformed", () => {
    // Under a Next.js `basePath` every demo path gains a leading segment.
    // The old 3-segment check read that as "not my route" and disabled the
    // guard for EVERY demo through configuration alone.
    const route = classifyDemoPathname(
      "/base/spring-ai/demos/mcp-apps",
      "spring-ai",
    );
    expect(route.kind).toBe("malformed");
    expect(route.kind === "malformed" && route.reason).toContain("basePath");
  });

  it("reports a path naming a different integration as malformed", () => {
    // This is the spoofed-header case: the middleware matcher skips paths
    // containing a dot, so on those a client controls `x-pathname`. A header
    // naming another slug must not be waved through.
    const route = classifyDemoPathname("/agno/demos/mcp-apps", "spring-ai");
    expect(route.kind).toBe("malformed");
    expect(route.kind === "malformed" && route.reason).toContain("spring-ai");
  });

  it("reports a non-demo path as malformed", () => {
    expect(
      classifyDemoPathname("/spring-ai/other/mcp-apps", "spring-ai").kind,
    ).toBe("malformed");
    expect(classifyDemoPathname("/", "spring-ai").kind).toBe("malformed");
  });
});

/** showcase/integrations — the tree the loader reads, located independently. */
const INTEGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../integrations",
);

/**
 * Integration directories that ship a manifest, read straight off disk.
 * Directories starting with `_` are shared tooling, not integrations.
 */
function manifestDirsOnDisk(): string[] {
  return fs
    .readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .filter((name) =>
      fs.existsSync(path.join(INTEGRATIONS_DIR, name, "manifest.yaml")),
    )
    .sort();
}

/**
 * The demo-id union, re-derived from the raw YAML on disk.
 *
 * Deliberately a second implementation of the union rule (`features` +
 * `not_supported_features` + `demos[].id`): comparing the loader's answer to
 * its own definition would prove nothing, and the rule is what a manifest
 * author has to get right.
 */
function demoIdsOnDisk(): string[] {
  const ids = new Set<string>();
  for (const dir of manifestDirsOnDisk()) {
    const parsed = parse(
      fs.readFileSync(
        path.join(INTEGRATIONS_DIR, dir, "manifest.yaml"),
        "utf8",
      ),
    ) as {
      features?: string[];
      not_supported_features?: string[];
      demos?: { id: string }[];
    };
    for (const id of parsed.features ?? []) ids.add(id);
    for (const id of parsed.not_supported_features ?? []) ids.add(id);
    for (const demo of parsed.demos ?? []) ids.add(demo.id);
  }
  return [...ids].sort();
}

describe("real manifests on disk", () => {
  /**
   * Loaded in `beforeAll`, NOT in the describe body.
   *
   * `listIntegrations()` populates a module-level cache. In the describe body it
   * ran at COLLECTION time — before any test in this file executes — which is
   * the only reason this block ever saw the real tree: the
   * "manifest loading failures" block below re-points
   * `SHOWCASE_INTEGRATIONS_DIR` at synthetic temp trees and calls
   * `resetIntegrationsCacheForTests()`. Correctness therefore rested on vitest
   * running suites in DECLARATION order. Under `--sequence.shuffle` the temp
   * tree could be installed first and these tests would silently assert
   * against a three-manifest fixture while claiming to read the real 20.
   *
   * `beforeAll` moves the read into the run phase, and the `beforeEach` below
   * drops any cache a reordered sibling left behind.
   */
  let manifests: readonly IntegrationManifest[];

  beforeEach(() => {
    // The sibling block sets this env var; a reordered run must not leak it in.
    delete process.env[INTEGRATIONS_DIR_ENV];
    resetIntegrationsCacheForTests();
  });

  beforeAll(() => {
    delete process.env[INTEGRATIONS_DIR_ENV];
    resetIntegrationsCacheForTests();
    manifests = listIntegrations();
  });

  it("loads exactly the integration manifests that are on disk", () => {
    // Derived from disk on both sides. The old `length > 10` floor let ten
    // manifests silently stop loading — a staged image that copies half the
    // tree, or one directory renamed — and still passed. Equality also pins
    // that each manifest's declared `slug` matches the directory holding it,
    // which is how every consumer addresses an integration.
    expect(manifests.map((manifest) => manifest.slug)).toEqual(
      manifestDirsOnDisk(),
    );
    expect(getIntegration("langgraph-python")?.name).toBeTruthy();
  });

  it("resolves a supported pair and an unsupported pair", () => {
    expect(resolveDemoSupport("langgraph-python", "agentic-chat").kind).toBe(
      "supported",
    );
    expect(
      resolveDemoSupport("langgraph-python", "gen-ui-interrupt").kind,
    ).toBe("not-supported");
  });

  it("resolves cli-start as informational on every integration that lists it", () => {
    // All 20 manifests list `cli-start` under `features` with a command-only
    // row. Every one of them used to render as SUPPORTED on the integration
    // index — linked, and counted in "N of M demos supported by this backend".
    let checked = 0;
    for (const manifest of manifests) {
      if (!(manifest.features ?? []).includes("cli-start")) continue;
      checked += 1;
      expect(
        resolveDemoSupport(manifest.slug, "cli-start").kind,
        `${manifest.slug}/cli-start`,
      ).toBe("informational");
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it("exposes exactly the union of demo ids declared on disk", () => {
    // Was `length > 20`, which passed even if most manifests contributed
    // nothing. Equality against the disk-derived union catches both a demo
    // id that stops being listed and one that appears from nowhere.
    expect(listAllDemoIds()).toEqual(demoIdsOnDisk());
    expect(listAllDemoIds()).toContain("agentic-chat");
  });

  it("routes real manifests: promise-based slugs get HITL, native get useInterrupt", () => {
    const hooks = Object.fromEntries(
      manifests.map((manifest) => [
        manifest.slug,
        interruptHookForPattern(resolveInterruptPattern(manifest)),
      ]),
    );
    expect(hooks["google-adk"]).toBe("useHumanInTheLoop");
    expect(hooks["langgraph-python"]).toBe("useInterrupt");
    expect(hooks["langgraph-fastapi"]).toBe("useInterrupt");
    expect(hooks["langgraph-typescript"]).toBe("useInterrupt");
    expect(hooks["mastra"]).toBe("useInterrupt");

    for (const manifest of manifests) {
      const expected =
        manifest.interrupt_pattern === "promise-based"
          ? "useHumanInTheLoop"
          : "useInterrupt";
      expect(
        interruptHookForPattern(resolveInterruptPattern(manifest)),
        manifest.slug,
      ).toBe(expected);
    }
  });

  it("shares one known-demo-id set between the index and the guard", () => {
    // Two copies of "what counts as a known demo id" can drift: the index
    // would list an id the guard then calls malformed. Every listed id must
    // resolve to something other than "unknown demo".
    for (const demoId of listAllDemoIds()) {
      const support = resolveDemoSupport("langgraph-python", demoId);
      expect(
        support.kind === "malformed" ? support.reason : "",
        `listed demo id ${demoId} must be known to the guard`,
      ).not.toContain("Unknown Showcase demo");
    }
  });
});

/**
 * A deployment with zero manifests is never valid. Before these tests, that
 * state resolved every integration as `Unknown Showcase integration "x"` —
 * the most misleading error in the app, because it points the debugger at
 * the slug instead of at the missing directory.
 */
describe("manifest loading failures", () => {
  /**
   * Created in `beforeAll`, NOT in the describe body.
   *
   * `mkdtempSync` in the body runs at COLLECTION time, which happens for every
   * run of this file — including a filtered one (`vitest -t …`) that never
   * enters this block. The `afterAll` that removes the tree only runs if the
   * block runs, so a filtered run created a temp directory and orphaned it. The
   * pairing has to sit on the same hook lifecycle as its cleanup.
   */
  let scratch: string;

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "showcase-manifests-"));
  });

  afterEach(() => {
    delete process.env[INTEGRATIONS_DIR_ENV];
    resetIntegrationsCacheForTests();
  });

  // Without this the suite leaked a temp tree on every run.
  afterAll(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  function withDir(name: string, build: (dir: string) => void): string {
    const dir = path.join(scratch, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    build(dir);
    process.env[INTEGRATIONS_DIR_ENV] = dir;
    resetIntegrationsCacheForTests();
    return dir;
  }

  function writeManifest(dir: string, slug: string, body: string): void {
    fs.mkdirSync(path.join(dir, slug), { recursive: true });
    fs.writeFileSync(path.join(dir, slug, "manifest.yaml"), body, "utf8");
  }

  it("throws when the configured directory does not exist", () => {
    process.env[INTEGRATIONS_DIR_ENV] = path.join(scratch, "does-not-exist");
    resetIntegrationsCacheForTests();
    expect(() => listIntegrations()).toThrow(ManifestLoadError);
    expect(() => listIntegrations()).toThrow(INTEGRATIONS_DIR_ENV);
  });

  it("never falls back to the repo layout when the env var is set but wrong", () => {
    // Falling through would load a stale tree while the operator believes
    // the env var took effect.
    process.env[INTEGRATIONS_DIR_ENV] = path.join(scratch, "does-not-exist");
    resetIntegrationsCacheForTests();
    let loaded: readonly IntegrationManifest[] | null = null;
    try {
      loaded = listIntegrations();
    } catch {
      loaded = null;
    }
    expect(loaded).toBeNull();
  });

  it("throws, naming the directory, when it holds no manifests", () => {
    withDir("empty", () => {});
    expect(() => listIntegrations()).toThrow(ManifestLoadError);
    expect(() => listIntegrations()).toThrow(/No Showcase manifests found/);
    // Names the directory it looked in, so the operator knows what to fix.
    expect(() => listIntegrations()).toThrow(/empty/);
  });

  it("does not cache the empty result, so a later fix is picked up", () => {
    // THE RETRY SEMANTIC, unchanged: an operator who fixes the tree must not
    // need a restart. The negative window below only bounds how much filesystem
    // work the failing state costs; it never turns the failure permanent.
    const dir = withDir("late-fix", () => {});
    expect(() => listIntegrations()).toThrow(ManifestLoadError);
    writeManifest(dir, "spring-ai", "name: Spring AI\nslug: spring-ai\n");

    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(MANIFEST_FAILURE_TTL_MS + 1);
      expect(listIntegrations().map((m) => m.slug)).toEqual(["spring-ai"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-throws a failure from memory for one short window, WITHOUT re-reading the tree", () => {
    // The load is a synchronous `readdirSync` plus one `readFileSync` and one
    // YAML parse PER integration, in the request path. An unset or wrong
    // SHOWCASE_INTEGRATIONS_DIR is the likeliest deployment misconfiguration
    // there is, and under D6 fan-out (20 integrations x 3 routes, plus the
    // layout and the placeholder page per render) an uncached retry makes that
    // work a sustained sync-I/O storm.
    //
    // The ERROR is still thrown on every call — a caller must never be served a
    // silently empty list — but only the first call touches the disk.
    withDir("negative-window", (dir) => {
      writeManifest(dir, "broken", "name: Broken\n  slug: [unclosed\n");
    });
    const readdir = vi.spyOn(fs, "readdirSync");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => listIntegrations()).toThrow(ManifestLoadError);
    }
    expect(readdir).toHaveBeenCalledTimes(1);
    readdir.mockRestore();
  });

  it("logs nothing and forgets the failure once resetIntegrationsCacheForTests runs", () => {
    // `resetDemoRuntimeState` in demo-runtime.ts calls this, so a test that
    // re-points the env var after a failed load must not be served the previous
    // test's error for a whole TTL window.
    const dir = withDir("reset-clears-negative", () => {});
    expect(() => listIntegrations()).toThrow(ManifestLoadError);
    writeManifest(dir, "agno", "name: Agno\nslug: agno\n");
    resetIntegrationsCacheForTests();
    expect(listIntegrations().map((m) => m.slug)).toEqual(["agno"]);
  });

  it("names the file when one manifest is malformed YAML", () => {
    withDir("bad-yaml", (dir) => {
      writeManifest(dir, "good", "name: Good\nslug: good\n");
      writeManifest(dir, "broken", "name: Broken\n  slug: [unclosed\n");
    });
    expect(() => listIntegrations()).toThrow(ManifestLoadError);
    expect(() => listIntegrations()).toThrow(/broken/);
    expect(() => listIntegrations()).toThrow(/manifest\.yaml/);
  });

  it("does not skip a malformed manifest, because skipping hides drift", () => {
    withDir("bad-yaml-keeps-loud", (dir) => {
      writeManifest(dir, "good", "name: Good\nslug: good\n");
      writeManifest(dir, "broken", "name: Broken\n  slug: [unclosed\n");
    });
    expect(() => getIntegration("good")).toThrow(ManifestLoadError);
  });

  it.each([
    ["empty file", ""],
    ["a YAML list", "- name: Nope\n  slug: nope\n"],
    ["a typo'd slug key", "name: Typo\nslugg: typo\n"],
    ["a blank slug", 'name: Blank\nslug: ""\n'],
  ])("throws, naming the file, for %s", (_label, body) => {
    withDir("bad-shape", (dir) => {
      writeManifest(dir, "offender", body);
    });
    expect(() => listIntegrations()).toThrow(ManifestLoadError);
    expect(() => listIntegrations()).toThrow(/offender/);
  });

  it.each([
    ["an empty value", ""],
    ["a whitespace-only value", "   "],
    ["an unexpanded ${...} reference", "${STAGED_MANIFESTS}"],
  ])(
    `rejects ${INTEGRATIONS_DIR_ENV} set to %s, never falling back to the repo layout`,
    (_label, value) => {
      // All three are FALSY or bogus, and the repo-relative fallback would
      // SUCCEED from this cwd — so the operator who set the variable would be
      // served the repo tree, or told the variable "is not set". The doc
      // comment has always forbidden that fall-through; `if (explicit)` did it
      // anyway. Same truthiness-vs-undefined bug `resolveHost` was rewritten
      // for in showcase/integrations/mastra/src/agent_server.ts.
      process.env[INTEGRATIONS_DIR_ENV] = value;
      resetIntegrationsCacheForTests();
      expect(() => listIntegrations()).toThrow(ManifestLoadError);
      expect(() => listIntegrations()).toThrow(/is not a path/);
      expect(() => listIntegrations()).toThrow(INTEGRATIONS_DIR_ENV);
    },
  );

  it("follows a SYMLINKED integration directory instead of dropping it", () => {
    // `readdirSync(..., { withFileTypes: true })` has LSTAT semantics: a
    // symlink pointing at a directory reports `isSymbolicLink() === true` and
    // `isDirectory() === false`, so a bare `isDirectory()` test skipped it
    // wordlessly — and a dropped manifest reads downstream as "that
    // integration does not exist", the error `ManifestLoadError` exists to
    // eliminate. SHOWCASE_INTEGRATIONS_DIR points at an operator-staged tree,
    // where assembling it from links is natural.
    const target = path.join(scratch, "link-target");
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(target, "manifest.yaml"),
      "name: Spring AI\nslug: spring-ai\n",
      "utf8",
    );

    const dir = withDir("symlinked", (staged) => {
      writeManifest(staged, "agno", "name: Agno\nslug: agno\n");
    });
    // `junction` on Windows: a plain `dir` symlink needs elevation or Developer
    // Mode there, a junction does not, and Node reports both as symbolic links.
    fs.symlinkSync(
      target,
      path.join(dir, "spring-ai"),
      process.platform === "win32" ? "junction" : "dir",
    );

    // Pins the platform behaviour the fix is FOR. If some future Node reports
    // the link as a directory, the fix becomes redundant rather than wrong —
    // and this line says which of the two happened.
    const entry = fs
      .readdirSync(dir, { withFileTypes: true })
      .find((candidate) => candidate.name === "spring-ai");
    expect(entry?.isSymbolicLink()).toBe(true);
    expect(entry?.isDirectory()).toBe(false);

    expect(listIntegrations().map((m) => m.slug)).toEqual([
      "agno",
      "spring-ai",
    ]);
  });

  it("rejects a duplicate demo id inside ONE manifest", () => {
    // `.find` makes the second entry unreachable: its route, agent and runtime
    // are ignored with no diagnostic anywhere. Same rule as two manifests
    // claiming one slug, for the same reason.
    withDir("dup-demo", (dir) => {
      writeManifest(
        dir,
        "spring-ai",
        "name: Spring AI\nslug: spring-ai\ndemos:\n" +
          "  - id: agentic-chat\n    name: First\n" +
          "  - id: agentic-chat\n    name: Second\n",
      );
    });
    expect(() => listIntegrations()).toThrow(ManifestLoadError);
    expect(() => listIntegrations()).toThrow(/agentic-chat/);
    expect(() => listIntegrations()).toThrow(/twice/);
  });

  /**
   * The agent/runtime fields. `agent-resolution.ts` widens this module's
   * manifest type with them and reads them without re-checking their shape, so
   * `assertManifest` is the ONLY shape gate they have — and every wrong shape
   * below used to fail silently rather than loudly.
   */
  it.each([
    [
      "runtime as a scalar (spread into CopilotRuntime by its CHARACTERS)",
      "demos:\n  - id: agentic-chat\n    runtime: openGenerativeUI\n",
      /"runtime" on demos\[0\]/,
    ],
    [
      "agent as a scalar (agent.path undefined, so the ROOT agent answers)",
      "demos:\n  - id: agentic-chat\n    agent: /subagents/agui\n",
      /"agent" on demos\[0\]/,
    ],
    [
      "agent_defaults as a scalar (spreads to {} and the block is dropped)",
      "agent_defaults: 25\n",
      /"agent_defaults" field/,
    ],
    [
      "a non-string agent.path",
      "demos:\n  - id: agentic-chat\n    agent:\n      path: 12\n",
      /"agent\.path" on demos\[0\]/,
    ],
    [
      "a non-mapping agent.config",
      "demos:\n  - id: agentic-chat\n    agent:\n      config: 25\n",
      /"agent\.config" on demos\[0\]/,
    ],
    [
      "a non-string route (a broken dashboard href)",
      "demos:\n  - id: agentic-chat\n    route: 123\n",
      /"route" on demos\[0\]/,
    ],
    [
      "a non-string command",
      "demos:\n  - id: agentic-chat\n    command: [npx, copilotkit]\n",
      /"command" on demos\[0\]/,
    ],
    [
      "a non-string agent_kind",
      "agent_kind:\n  - langgraph\n",
      /"agent_kind" field/,
    ],
    // EXPLICIT YAML NULL. A key written with nothing under it is a
    // mis-indented, emptied or commented-out block — never "absent". The
    // `agent:` case is the expensive one: the value was null, `agent?.path`
    // was undefined, and the request was joined as `<base>/`, so the
    // integration's ROOT agent answered and streamed plausible text for the
    // WRONG demo. That is verbatim the failure the `agent` guard exists to
    // prevent, and only the SCALAR spelling was caught.
    [
      "an explicit null agent (the mis-indentation the guard warns about)",
      "demos:\n  - id: agentic-chat\n    route: /demos/agentic-chat\n    agent:\n",
      /"agent" on demos\[0\][\s\S]*explicit YAML null/,
    ],
    [
      "an explicit null runtime",
      "demos:\n  - id: agentic-chat\n    route: /demos/agentic-chat\n    runtime:\n",
      /"runtime" on demos\[0\][\s\S]*explicit YAML null/,
    ],
    [
      "an explicit null agent.config",
      "demos:\n  - id: agentic-chat\n    agent:\n      config:\n",
      /"agent\.config" on demos\[0\][\s\S]*explicit YAML null/,
    ],
    [
      "an explicit null agent_defaults",
      "agent_defaults:\n",
      /explicit YAML null/,
    ],
    [
      "an explicit null route",
      "demos:\n  - id: agentic-chat\n    route:\n",
      /"route" on demos\[0\]/,
    ],
    // Declared on `ManifestDemo`, RENDERED, and previously unchecked — so the
    // `asserts value is IntegrationManifest` narrowing lied about them.
    [
      "a non-string description",
      "description:\n  - paragraph\n",
      /"description" field/,
    ],
    [
      "a scalar demos[].tags (every consumer iterates its CHARACTERS)",
      "demos:\n  - id: agentic-chat\n    route: /demos/agentic-chat\n    tags: agentic\n",
      /"tags" on demos\[0\]/,
    ],
    [
      "a non-string entry in demos[].highlight",
      "demos:\n  - id: agentic-chat\n    route: /demos/agentic-chat\n    highlight:\n      - 42\n",
      /"highlight" on demos\[0\]/,
    ],
  ])("throws for %s", (_label, extra, expected) => {
    withDir("bad-agent-shape", (dir) => {
      writeManifest(
        dir,
        "offender",
        `name: Offender\nslug: offender\n${extra}`,
      );
    });
    expect(() => listIntegrations()).toThrow(ManifestLoadError);
    expect(() => listIntegrations()).toThrow(expected);
  });

  /**
   * UNKNOWN KEYS. The shape checks above could not see a TYPO, because every
   * optional field is legal when ABSENT — so a misspelled key was
   * indistinguishable from an omitted one everywhere in this validator.
   *
   * `agent: { pth: … }` is the expensive spelling and the reason this exists:
   * `agent` IS a mapping (so the mapping guard passes), `path`, `graph` and
   * `name` are all `undefined` (legal), `config` is absent — so `joinAgentUrl`
   * yields `<base>/`, the request reaches the integration's ROOT agent, and it
   * answers and streams plausible text for the WRONG demo. That is verbatim the
   * failure this file's docstring calls "the failure that looks like a model
   * problem and costs a day", reached by one transposed character.
   */
  it.each([
    [
      "a typo'd agent.path — the ROOT-agent failure, one character away",
      "demos:\n  - id: agentic-chat\n    route: /demos/agentic-chat\n" +
        "    agent:\n      pth: /subagents/agui\n",
      /"agent" key\(s\) on demos\[0\][\s\S]*"pth"[\s\S]*did you mean "path"/,
    ],
    [
      "a typo'd agent.graph",
      "agent_kind: langgraph\ndemos:\n  - id: agentic-chat\n" +
        "    route: /demos/agentic-chat\n    agent:\n      grph: a2ui_dynamic\n",
      /did you mean "graph"/,
    ],
    [
      "a typo'd agent.config (silently drops every agent-construction option)",
      "demos:\n  - id: agentic-chat\n    agent:\n      confg:\n        recursion_limit: 25\n",
      /did you mean "config"/,
    ],
    [
      "a typo'd demos[].route (no page, and the row reads as informational)",
      "demos:\n  - id: agentic-chat\n    rout: /demos/agentic-chat\n",
      /field\(s\) on demos\[0\][\s\S]*did you mean "route"/,
    ],
    [
      "a typo'd demos[].runtime (every CopilotRuntime option is dropped)",
      "demos:\n  - id: agentic-chat\n    route: /demos/agentic-chat\n" +
        "    runtim:\n      openGenerativeUI: true\n",
      /did you mean "runtime"/,
    ],
    [
      "a typo'd demos[].command (an informational cell with nothing to copy)",
      "demos:\n  - id: agentic-chat\n    commnd: npx copilotkit@latest init\n",
      /did you mean "command"/,
    ],
    [
      "a typo'd top-level agent_kind (silently resolves as http)",
      "agent_kinds: langgraph\n",
      /top-level field\(s\)[\s\S]*did you mean "agent_kind"/,
    ],
    [
      "a typo'd top-level agent_defaults",
      "agent_default:\n  recursion_limit: 100\n",
      /did you mean "agent_defaults"/,
    ],
    [
      "a typo'd top-level features (every demo reads as unsupported)",
      "featurs:\n  - agentic-chat\n",
      /did you mean "features"/,
    ],
    [
      "a key that resembles nothing at all — still fatal, just with no hint",
      "demos:\n  - id: agentic-chat\n    route: /demos/agentic-chat\n" +
        "    zzzzzzzzzzz: 1\n",
      /"zzzzzzzzzzz"/,
    ],
  ])("throws for %s", (_label, extra, expected) => {
    withDir("unknown-key", (dir) => {
      writeManifest(
        dir,
        "offender",
        `name: Offender\nslug: offender\n${extra}`,
      );
    });
    expect(() => listIntegrations()).toThrow(ManifestLoadError);
    expect(() => listIntegrations()).toThrow(expected);
  });

  it("names the allowed keys, so the reader does not have to find the schema", () => {
    withDir("unknown-key-hint", (dir) => {
      writeManifest(
        dir,
        "offender",
        "name: Offender\nslug: offender\ndemos:\n  - id: x\n" +
          "    agent:\n      pth: /y\n",
      );
    });
    expect(() => listIntegrations()).toThrow(
      /"config", "graph", "name", "path"/,
    );
  });

  it("leaves the FREE-FORM blocks open — an unknown key there is the point", () => {
    // `agent_defaults`, `agent.config` and `demos[].runtime` carry keys that
    // belong to a framework or to CopilotRuntime, not to this app. Closing them
    // would reject `recursion_limit`, `openGenerativeUI`, and every option this
    // app has never heard of — which `demos[].runtime` exists to pass through.
    withDir("free-form-open", (dir) => {
      writeManifest(
        dir,
        "offender",
        "name: Offender\nslug: offender\n" +
          "agent_defaults:\n  some_future_agent_option: 1\n" +
          "demos:\n  - id: agentic-chat\n    route: /demos/agentic-chat\n" +
          "    runtime:\n      someFutureRuntimeOption: true\n" +
          "    agent:\n      config:\n        another_future_option: 2\n",
      );
    });
    expect(listIntegrations()[0].demos).toHaveLength(1);
  });

  it("accepts every key the 20 real manifests actually use", () => {
    // THE COUNTERWEIGHT that matters most for a closed key set: the real tree
    // must load. It is read through `listIntegrations` here rather than by
    // re-listing the keys, so a manifest that legitimately gains a schema field
    // fails HERE — with the field named — instead of at request time.
    delete process.env[INTEGRATIONS_DIR_ENV];
    resetIntegrationsCacheForTests();
    expect(listIntegrations().length).toBeGreaterThanOrEqual(20);
  });

  it("accepts the shapes the real manifests use", () => {
    // The counterweight: every rejection above must leave the legitimate
    // spelling alone, or the loader is just broken in a new direction.
    withDir("good-agent-shape", (dir) => {
      writeManifest(
        dir,
        "agno",
        "name: Agno\nslug: agno\nagent_kind: http\n" +
          "agent_defaults:\n  recursion_limit: 100\n" +
          "demos:\n" +
          "  - id: subagents\n    name: Subagents\n    route: /demos/subagents\n" +
          "    agent:\n      path: /subagents/agui\n      name: subagents\n" +
          "      config:\n        recursion_limit: 25\n" +
          "    runtime:\n      openGenerativeUI: true\n" +
          "  - id: cli-start\n    name: CLI\n    command: npx copilotkit@latest init\n",
      );
    });
    expect(listIntegrations()[0].demos).toHaveLength(2);
  });

  it("ignores an integration directory that ships no manifest at all", () => {
    withDir("partial", (dir) => {
      writeManifest(dir, "spring-ai", "name: Spring AI\nslug: spring-ai\n");
      fs.mkdirSync(path.join(dir, "tooling-only"), { recursive: true });
    });
    expect(listIntegrations().map((m) => m.slug)).toEqual(["spring-ai"]);
  });
});
