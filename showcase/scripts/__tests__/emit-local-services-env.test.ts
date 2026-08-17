/**
 * emit-local-services-env.ts — the compose-side bridge for the `demo_frontend`
 * manifest field.
 *
 * What these tests actually guard: that the ONE tracked field is the only input,
 * that the artifact on disk is a faithful projection of it (so CI's `--check`
 * is meaningful), and that a manifest which cannot be parsed FAILS rather than
 * being silently reported as un-migrated. That last one is the whole point —
 * "quietly assume integration" is the half-migrated state this field exists to
 * remove.
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  localServiceUrlKey,
  readSlugFrontends,
  renderEnvFile,
} from "../emit-local-services-env";
import type { SlugFrontend } from "../emit-local-services-env";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url)).replace(
  /[\\/]__tests__$/,
  "",
);
const SHOWCASE_DIR = resolve(SCRIPTS_DIR, "..");
const EMITTER = join(SCRIPTS_DIR, "emit-local-services-env.ts");
const TRACKED_ARTIFACT = join(SHOWCASE_DIR, "local-services.generated.env");
const INTEGRATIONS_DIR = join(SHOWCASE_DIR, "integrations");

/** Minimal manifest that satisfies parseManifest's cross-field checks. */
function manifestYaml(slug: string, demoFrontend?: string): string {
  return [
    `name: ${slug}`,
    `slug: ${slug}`,
    ...(demoFrontend ? [`demo_frontend: ${demoFrontend}`] : []),
    "features:",
    "  - agentic-chat",
    "demos:",
    "  - id: agentic-chat",
    "    route: /demos/agentic-chat",
    "",
  ].join("\n");
}

function withFixtureTree(
  manifests: ReadonlyArray<{ slug: string; body: string }>,
  fn: (integrationsDir: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "emit-lse-"));
  try {
    const integrationsDir = join(root, "integrations");
    for (const { slug, body } of manifests) {
      mkdirSync(join(integrationsDir, slug), { recursive: true });
      writeFileSync(join(integrationsDir, slug, "manifest.yaml"), body);
    }
    mkdirSync(integrationsDir, { recursive: true });
    fn(integrationsDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("localServiceUrlKey", () => {
  it("upper-snake-cases the slug the way the compose file and _common.sh do", () => {
    expect(localServiceUrlKey("langgraph-python")).toBe(
      "LOCAL_SERVICE_URL_LANGGRAPH_PYTHON",
    );
    expect(localServiceUrlKey("ag2")).toBe("LOCAL_SERVICE_URL_AG2");
  });
});

describe("readSlugFrontends", () => {
  it("defaults an omitted demo_frontend to integration", () => {
    withFixtureTree([{ slug: "alpha", body: manifestYaml("alpha") }], (dir) => {
      expect(readSlugFrontends(dir)).toEqual([
        { slug: "alpha", frontend: "integration" },
      ]);
    });
  });

  it("reads both declared values and sorts by slug", () => {
    withFixtureTree(
      [
        { slug: "zulu", body: manifestYaml("zulu", "unified") },
        { slug: "alpha", body: manifestYaml("alpha", "integration") },
      ],
      (dir) => {
        expect(readSlugFrontends(dir)).toEqual([
          { slug: "alpha", frontend: "integration" },
          { slug: "zulu", frontend: "unified" },
        ]);
      },
    );
  });

  it("skips underscore-prefixed support directories (_shared)", () => {
    withFixtureTree(
      [
        { slug: "alpha", body: manifestYaml("alpha") },
        { slug: "_shared", body: "not: a manifest\n" },
      ],
      (dir) => {
        expect(readSlugFrontends(dir).map((e) => e.slug)).toEqual(["alpha"]);
      },
    );
  });

  it("THROWS on an unparseable manifest instead of reporting it un-migrated", () => {
    // A skip here would emit an artifact asserting the slug is on its own
    // frontend when nobody actually knows — the exact silent-wrong-answer this
    // field replaced.
    withFixtureTree([{ slug: "alpha", body: "demos: [oops\n" }], (dir) => {
      expect(() => readSlugFrontends(dir)).toThrow(
        /cannot derive demo_frontend for "alpha"/,
      );
    });
  });

  it("THROWS on an unknown demo_frontend value", () => {
    withFixtureTree(
      [{ slug: "alpha", body: manifestYaml("alpha", "unifed") }],
      (dir) => {
        expect(() => readSlugFrontends(dir)).toThrow(/demo_frontend/);
      },
    );
  });
});

describe("renderEnvFile", () => {
  it("emits nothing for an all-unmigrated fleet", () => {
    const entries: SlugFrontend[] = [
      { slug: "alpha", frontend: "integration" },
      { slug: "beta", frontend: "integration" },
    ];
    const out = renderEnvFile(entries);
    expect(out).not.toMatch(/^LOCAL_SERVICE_URL_/m);
    expect(out).toContain("No slug is migrated");
  });

  it("emits exactly one assignment per migrated slug, and none for the rest", () => {
    const out = renderEnvFile([
      { slug: "alpha", frontend: "integration" },
      { slug: "beta", frontend: "unified" },
    ]);
    const assignments = out
      .split("\n")
      .filter((l) => l.startsWith("LOCAL_SERVICE_URL_"));
    expect(assignments).toEqual([
      "LOCAL_SERVICE_URL_BETA=http://frontend-nextjs:3000/beta",
    ]);
  });

  it("keeps the /<slug> path segment — consumers append /demos/<id>", () => {
    // Without the segment every cell of a migrated run probes the unified app's
    // root and 404s. This is the one substring that must not be optimised away.
    const out = renderEnvFile([{ slug: "beta", frontend: "unified" }]);
    expect(out).toContain("http://frontend-nextjs:3000/beta");
  });

  it("is pure ASCII — _common.sh parses it with sed/read", () => {
    const out = renderEnvFile([{ slug: "beta", frontend: "unified" }]);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(out)).toBe(true);
  });
});

describe("the tracked artifact", () => {
  it("matches what the real manifests imply (this is what CI's --check asserts)", () => {
    const expected = renderEnvFile(readSlugFrontends(INTEGRATIONS_DIR));
    expect(readFileSync(TRACKED_ARTIFACT, "utf8")).toBe(expected);
  });

  it("declares EXACTLY the migrated roster and nothing else", () => {
    // Deliberate pin, both directions. Migrating a slug is a separate,
    // independently verifiable step; if this goes red, someone changed the
    // migrated roster and this test is the reminder to verify it LIVE (full D6
    // matrix through the default fleet path) rather than a nuisance to delete.
    //
    // Every entry below was verified LIVE the same way: a full D6 matrix
    // BEFORE the flip and a full D6 matrix AFTER it, both through the default
    // fleet path (`bash bin/showcase test <slug> --d6 --verbose`, NOT
    // `--direct`), compared cell by cell for regressions.
    //
    // langgraph-python  41-cell matrix, demos served from
    //                   localhost:3200/langgraph-python/demos/*, agent still on
    //                   the integration's own origin.
    // built-in-agent    41-cell matrix. Baseline 30 green / 7 red / 4
    //                   skipped-incapable; migrated IDENTICAL (30/7/4), zero
    //                   regressions. `agent_kind: in-process`, so the agent
    //                   axis is NOMINAL after the flip: the AG-UI runtime
    //                   requests were observed going to
    //                   frontend-nextjs:3000/api/built-in-agent/<demo>, i.e.
    //                   the same origin as the pages, and nothing dialled
    //                   built-in-agent:10000.
    // mastra            43-cell matrix, the largest. Baseline 34 green / 9 red
    //                   / 0 skipped; migrated 35 green / 8 red / 0 skipped —
    //                   zero regressions, and hitl-approve-deny went
    //                   fail -> pass. `agent_kind: http`, and the agent axis
    //                   STAYED on the integration's own origin: the pages moved
    //                   to frontend-nextjs:3000/mastra/demos/*, whose runtime
    //                   route proxies server-side to AGENT_URL_MASTRA
    //                   (http://mastra:8000).
    //
    // Update BOTH lists below together when the roster changes; they are the
    // same fact read from the two derivations (the tracked artifact and the
    // manifests) that must never disagree.
    // ms-agent-python   40-cell matrix. Baseline 34 green / 4 red / 2
    //                   skipped-incapable; migrated IDENTICAL (34/4/2), zero
    //                   regressions, and all four pre-existing reds failed with
    //                   byte-identical error strings. `agent_kind: http`, so the
    //                   agent axis stayed on the integration's own origin: pages
    //                   moved to frontend-nextjs:3000/ms-agent-python/demos/*
    //                   while the AG-UI POSTs were still observed arriving at
    //                   the ms-agent-python container
    //                   (AGENT_URL_MS_AGENT_PYTHON).
    // strands           40-cell matrix. Baseline 32 green / 4 red / 4
    //                   skipped-incapable; migrated IDENTICAL (32/4/4), zero
    //                   regressions. Three reds byte-identical; frontend-tools
    //                   differed only in its run counters (runsFinished 49 -> 48,
    //                   runStartCount 50 -> 49) with the same
    //                   reason=done-signal-missing timeout — jitter in one
    //                   failure mode, flagged not normalised. `agent_kind: http`,
    //                   so the agent axis stayed on the strands container.
    // spring-ai         38-cell matrix, the only JVM cell in the fleet.
    //                   Baseline 29 green / 6 red / 3 skipped-incapable;
    //                   migrated IDENTICAL (29/6/3), zero regressions, and all
    //                   six pre-existing reds failed with byte-identical error
    //                   strings. `agent_kind: http`, so the agent axis stayed
    //                   on the spring-ai container: pages moved to
    //                   frontend-nextjs:3000/spring-ai/demos/* while the AG-UI
    //                   POSTs were still observed arriving at Spring Boot on
    //                   port 8000. Its five `not_supported_features` entries
    //                   produce only THREE skipped cells — two of them
    //                   (`reasoning-default-render`, `agentic-chat-reasoning`)
    //                   name no D5 feature type and are inert.
    // ms-agent-dotnet   41-cell matrix. Baseline 34 green / 5 red / 2
    //                   skipped-incapable; migrated IDENTICAL (34/5/2), zero
    //                   regressions. reasoning-display stayed green via
    //                   synthetic_reasoning_demos + unified reasoning-shim.ts.
    //                   All five pre-existing reds failed with BYTE-IDENTICAL
    //                   error strings. `agent_kind: http`, so the agent axis
    //                   stayed on the ms-agent-dotnet container: pages moved to
    //                   frontend-nextjs:3000/ms-agent-dotnet/demos/* while
    //                   aggregateSignal.backendUrl stayed
    //                   http://ms-agent-dotnet:10000.
    // ms-agent-harness-dotnet
    //                   40-cell matrix. Baseline 32 green / 5 red / 3
    //                   skipped-incapable; migrated IDENTICAL (32/5/3), zero
    //                   regressions. reasoning-display stayed green the same
    //                   way. All five pre-existing reds failed with
    //                   BYTE-IDENTICAL error strings. `agent_kind: http`.
    // strands-typescript
    //                   40-cell matrix. Baseline 32 green / 4 red / 4
    //                   skipped-incapable; migrated IDENTICAL (32/4/4), zero
    //                   regressions. Two reds byte-identical (gen-ui-agent,
    //                   multimodal). frontend-tools same
    //                   reason=done-signal-missing, count 10 -> 11. The
    //                   fourth, gen-ui-headless-complete, stayed red but
    //                   swapped assertion (baseline text-unstable turn 3;
    //                   migrated missing headless-revenue-chart). Not many
    //                   new reds; did not port forwardingProxyFetch.
    //                   `agent_kind: http`.
    // agno             39-cell matrix. Baseline 24 green / 11 red / 4
    //                   skipped-incapable; migrated IDENTICAL (24/11/4),
    //                   zero regressions. None of the nine lift cells
    //                   went green from the page move alone.
    //                   `agent_kind: http`.
    // claude-sdk-python 40-cell matrix. Baseline 36 green / 2 red / 2
    //                   skipped-incapable; migrated IDENTICAL (36/2/2),
    //                   zero regressions. Same two reds (gen-ui-agent,
    //                   tool-rendering-reasoning-chain). `agent_kind: http`.
    // google-adk        40-cell matrix. Baseline 37 green / 3 red / 0
    //                   skipped-incapable; migrated 37 / 3 / 0. Counts
    //                   match; red set does not. multimodal lifted after
    //                   the frontend-nextjs sample.png rebuild. New red:
    //                   gen-ui-interrupt (confirmed on a single-cell
    //                   re-run). `agent_kind: http`.
    // langgraph-fastapi 41-cell matrix. Baseline 37 green / 2 red / 2
    //                   skipped-incapable; migrated 36 / 3 / 2. New red:
    //                   a2ui-recovery (confirmed on a single-cell re-run).
    //                   `agent_kind: langgraph`.
    // ag2               37-cell matrix. Baseline 31 / 2 / 4; migrated
    //                   32 / 1 / 4. Zero regressions. multimodal lifted
    //                   after frontend-nextjs sample.png rebuild.
    //                   Remaining red: gen-ui-agent (fleet fixture).
    //                   `agent_kind: http`.
    // pydantic-ai       40-cell matrix. Baseline 33 / 3 / 4; migrated
    //                   34 / 2 / 4. Zero regressions. multimodal lifted
    //                   the same way. Remaining reds: gen-ui-agent,
    //                   reasoning-display. `agent_kind: http`.
    // claude-sdk-typescript
    //                   40-cell matrix. Baseline 35 / 3 / 2; migrated
    //                   IDENTICAL (35/3/2). Zero regressions. Same
    //                   three reds. `agent_kind: http`.
    // langgraph-typescript
    //                   41-cell matrix. Baseline 36 / 3 / 2; migrated
    //                   IDENTICAL (36/3/2). Zero regressions. Same
    //                   three reds. `agent_kind: langgraph`.
    // crewai-crews      last integration-frontend wave. 38-cell
    //                   baseline 25 / 7 / 6. Flip-only; D6 after
    //                   flip not run here. Implicit `agent_kind: http`.
    // langroid          same wave. 38-cell baseline 27 / 6 / 5.
    //                   Implicit `agent_kind: http`.
    // llamaindex        same wave. 39-cell baseline 28 / 6 / 5.
    //                   Implicit `agent_kind: http`.
    const MIGRATED = [
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
    ];

    const artifactKeys = readFileSync(TRACKED_ARTIFACT, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("LOCAL_SERVICE_URL_"))
      .map((l) => l.slice(0, l.indexOf("=")));
    expect(artifactKeys).toEqual(
      MIGRATED.map((s) => localServiceUrlKey(s)).sort(),
    );

    const manifestMigrated = readSlugFrontends(INTEGRATIONS_DIR)
      .filter((e) => e.frontend === "unified")
      .map((e) => e.slug);
    expect(manifestMigrated.sort()).toEqual([...MIGRATED].sort());
    for (const entry of readSlugFrontends(INTEGRATIONS_DIR)) {
      expect(entry.frontend, entry.slug).toBe(
        MIGRATED.includes(entry.slug) ? "unified" : "integration",
      );
    }
  });
});

describe("--check", () => {
  function runCheck(outPath: string): { status: number; stderr: string } {
    try {
      execFileSync(
        process.execPath,
        [
          join(SCRIPTS_DIR, "node_modules", "tsx", "dist", "cli.mjs"),
          EMITTER,
          "--check",
          `--out=${outPath}`,
        ],
        { stdio: "pipe", encoding: "utf8" },
      );
      return { status: 0, stderr: "" };
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      return { status: e.status ?? -1, stderr: e.stderr ?? "" };
    }
  }

  it("exits 0 against the tracked artifact", () => {
    expect(runCheck(TRACKED_ARTIFACT).status).toBe(0);
  });

  it("exits 1 and names the re-run command when the artifact is stale", () => {
    const dir = mkdtempSync(join(tmpdir(), "emit-lse-check-"));
    try {
      const stale = join(dir, "local-services.generated.env");
      writeFileSync(stale, "LOCAL_SERVICE_URL_ALPHA=http://wrong\n");
      const result = runCheck(stale);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("emit-local-services-env.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
