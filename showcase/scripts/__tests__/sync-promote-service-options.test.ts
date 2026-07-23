import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { SERVICES } from "../railway-envs";
// Importing the module MUST NOT trigger main() (the robust import.meta.url
// guard ensures the file only runs main when invoked directly, never on
// import). If this import wrote the workflow, the suite would have side
// effects on the real file — see the dedicated guard test below.
import { computeOptionTokens, SENTINEL } from "../sync-promote-service-options";
import type { ServiceEntry } from "../railway-envs";

const SCRIPT = resolve(__dirname, "..", "sync-promote-service-options.ts");

// The REAL, committed workflow file that GitHub validates the `service`
// workflow_dispatch choice against server-side. `gh workflow run` is rejected
// with HTTP 422 ("Provided value '<svc>' ... not in the list of allowed
// values") whenever a chosen value is absent from THIS file on the default
// branch — so the durable regression test below asserts against the committed
// file, not just the in-memory generator output.
const COMMITTED_WORKFLOW = resolve(
  __dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "showcase_promote.yml",
);

/**
 * The full set of services that MUST appear in the promote dropdown. This is
 * the regression guard's allowlist: if a future generator change (or a botched
 * SSOT edit) drops ANY of these, both the generator-output and committed-file
 * assertions below fail LOUDLY in CI.
 *
 * `shell-docs` is called out by name on purpose: it is promoted regularly by a
 * teammate, and the explicit worry is that a future pinning/generator
 * regression must NEVER silently strip it from the dropdown. The 12 `starter-*`
 * services are listed because they were historically OMITTED (the committed
 * dropdown was never regenerated after they joined the SSOT), which caused the
 * HTTP 422 rejection this regression test exists to prevent recurring.
 */
const REQUIRED_PROMOTE_TARGETS = [
  // The teammate-critical target — guarded by name, never just by count.
  "shell-docs",
  // The 12 starter-* container fleet (the previously-omitted set).
  "starter-adk",
  "starter-agno",
  "starter-crewai-crews",
  "starter-langgraph-fastapi",
  "starter-langgraph-js",
  "starter-langgraph-python",
  "starter-llamaindex",
  "starter-mastra",
  "starter-ms-agent-framework-dotnet",
  "starter-ms-agent-framework-python",
  "starter-pydantic-ai",
  "starter-strands-python",
] as const;

/**
 * Build a synthetic env-map `ServiceEntry` for computeOptionTokens tests.
 * Only the fields the generator reads matter (`environments.prod.probe` +
 * `dispatchName`); the rest are filler to satisfy the type. `slug` seeds the
 * placeholder IDs/domains so each synthetic entry is internally distinct.
 */
function mkEntry(
  slug: string,
  opts: { dispatchName?: string; prodProbe?: boolean } = {},
): ServiceEntry & { dispatchName?: string } {
  const { dispatchName, prodProbe = true } = opts;
  return {
    serviceId: `s-${slug}`,
    ciBuilt: true,
    gateValidated: true,
    probeDriver: "harness",
    ...(dispatchName !== undefined ? { dispatchName } : {}),
    environments: {
      prod: {
        instanceId: `p-${slug}`,
        domain: `${slug}.prod`,
        probe: prodProbe,
      },
      staging: {
        instanceId: `st-${slug}`,
        domain: `${slug}.staging`,
        probe: true,
      },
    },
  };
}

// The exact diagnostic fragments the generator emits for each marker-error
// case. Tests assert against these specific strings (not a generic /marker/i)
// so a regression that swaps one diagnostic for another is caught.
const DIAG_NOT_FOUND = "generated marker block not found";
const DIAG_DUPLICATE = "duplicate generated markers";
const DIAG_OUT_OF_ORDER = "malformed marker block";

// A minimal but representative workflow fixture: the real showcase_promote.yml
// has many more jobs, but for the generator's purposes all that matters is
// the `service:` input block carrying the generated marker region. We keep
// unrelated content around the markers to prove it is preserved verbatim.
const BEGIN =
  "# >>> BEGIN GENERATED service options (showcase/scripts/sync-promote-service-options.ts) — DO NOT EDIT";
const END = "# <<< END GENERATED service options";

function fixture(generatedBody: string): string {
  return [
    'name: "Showcase: Promote (staging → prod)"',
    "",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      service:",
    '        description: "Service to promote"',
    "        required: true",
    "        type: choice",
    `        ${BEGIN}`,
    generatedBody,
    `        ${END}`,
    "      digest:",
    '        description: "Optional digest override"',
    "        required: false",
    "        type: string",
    "",
    "jobs:",
    "  resolve-targets:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo hi",
    "",
  ].join("\n");
}

// A synthetic services map shaped like SERVICES (Record<string, ServiceEntry
// & { dispatchName?: string }>). Only the fields computeOptionTokens reads
// (`probe.prod` and `dispatchName`) carry meaningful values here; the rest are
// filler to satisfy the type. Keys are deliberately ordered so that sorting by
// SSOT KEY would produce a DIFFERENT order than sorting by the RENDERED token,
// proving the sort is by rendered token.
const SYNTHETIC: typeof SERVICES = {
  // SSOT key "zeta" but renders as "alpha" via dispatchName → must sort FIRST.
  zeta: mkEntry("zeta", { dispatchName: "alpha" }),
  // SSOT key "beta", no dispatchName → token falls back to the bare key
  // "beta", which sorts AFTER the rendered token "alpha" (from key "zeta").
  beta: mkEntry("beta"),
  // prod:false → MUST be excluded from the dropdown entirely.
  excluded: mkEntry("excl", {
    dispatchName: "aaa-would-sort-first",
    prodProbe: false,
  }),
};

describe("computeOptionTokens (unit)", () => {
  it("excludes probe.prod:false, sorts by rendered token, prefers dispatchName", () => {
    const tokens = computeOptionTokens(SYNTHETIC);

    // (a) The prod:false entry is excluded even though its dispatchName
    // ("aaa-would-sort-first") would otherwise sort to the very front.
    expect(tokens).not.toContain("aaa-would-sort-first");
    expect(tokens).not.toContain("excluded");

    // (c) dispatchName wins over the SSOT key: "zeta" surfaces as "alpha",
    // and its bare key never appears.
    expect(tokens).toContain("alpha");
    expect(tokens).not.toContain("zeta");
    // "beta" has no dispatchName → its key is used verbatim.
    expect(tokens).toContain("beta");

    // (b) Ordering: SENTINEL, then "all", then promotable tokens sorted
    // alphabetically by the RENDERED token. Sorting by SSOT key would have
    // put "beta" before "alpha" (because key "beta" < key "zeta"); the
    // rendered-token sort puts "alpha" first.
    expect(tokens).toEqual([SENTINEL, "all", "alpha", "beta"]);
  });

  it("throws (fail loud) on a YAML-unsafe rendered token, naming token + SSOT key", () => {
    // A future SSOT entry whose dispatchName carries a YAML-special char (here
    // a colon + space) would, if interpolated raw, emit a malformed workflow
    // the pre-commit hook silently `git add`s. The generator must fail loud.
    const badMap: typeof SERVICES = {
      // colon + space → NOT YAML-safe
      gamma: mkEntry("gamma", { dispatchName: "bad: token" }),
    };
    expect(() => computeOptionTokens(badMap)).toThrow(/not YAML-safe/);
    // The diagnostic names the offending token and its SSOT key.
    expect(() => computeOptionTokens(badMap)).toThrow(/bad: token/);
    expect(() => computeOptionTokens(badMap)).toThrow(/gamma/);
  });

  it("throws (fail loud) on a duplicate assembled token, naming the offender", () => {
    // Two distinct SSOT keys whose RENDERED tokens collide: key "dup-a" has
    // dispatchName "dup", and key "dup" has no dispatchName → both render as
    // "dup". assertDispatchNamesUnique would NOT catch this (it only compares
    // dispatchName-vs-dispatchName), so the generator must guard the
    // assembled list itself or it would emit a duplicate `- dup` option that
    // the pre-commit hook silently `git add`s. The exact-match resolve guard
    // catches it because token "dup" matches BOTH services (key "dup" by
    // name, key "dup-a" by dispatchName) → resolves to 2, not 1.
    const dupMap: typeof SERVICES = {
      "dup-a": mkEntry("dupa", { dispatchName: "dup" }),
      // no dispatchName → renders as the bare key "dup", colliding with the
      // dispatchName above.
      dup: mkEntry("dup"),
    };
    expect(() => computeOptionTokens(dupMap)).toThrow(/resolves to 2 services/);
    expect(() => computeOptionTokens(dupMap)).toThrow(/"dup"/);
  });

  it("throws (fail loud) on a CROSS-collision the dedupe guard misses: distinct rendered tokens that resolve ambiguously", () => {
    // The bug the exact-match resolve guard exists to catch, which the OLD
    // rendered-token dedupe guard MISSED:
    //   - Service A ("svc-a") has dispatchName "foo" → renders token "foo".
    //   - Service B ("foo")  has dispatchName "bar" → renders token "bar".
    // The two RENDERED tokens ("foo" and "bar") are DISTINCT, so a dedupe
    // guard sees no duplicate and passes. But under the workflow resolve
    // predicate (s.name === T || s.dispatchName === T), token "foo" matches
    // BOTH A (by dispatchName "foo") AND B (by name "foo") → ambiguous and
    // un-promotable. The generator must fail loud, naming the ambiguous
    // token and both colliding service keys.
    const crossMap: typeof SERVICES = {
      "svc-a": mkEntry("a", { dispatchName: "foo" }), // renders token "foo"
      // renders token "bar" (DISTINCT from "foo")
      foo: mkEntry("foo", { dispatchName: "bar" }),
    };
    // Token "foo" resolves to 2 services (svc-a by dispatchName, foo by name).
    expect(() => computeOptionTokens(crossMap)).toThrow(
      /resolves to 2 services/,
    );
    // Diagnostic names the ambiguous token and BOTH colliding service keys.
    expect(() => computeOptionTokens(crossMap)).toThrow(/"foo"/);
    expect(() => computeOptionTokens(crossMap)).toThrow(/svc-a/);
  });

  it("does NOT throw when a prod:false service shares a token with a prod-eligible service (resolve step also filters probe.prod)", () => {
    // The generator's uniqueness guard mirrors the workflow resolve step's
    // predicate EXACTLY — including its `probe.prod === true` filter. So a
    // non-prod service sharing a name/dispatchName token with a prod-eligible
    // service is NOT a collision: the resolve step would filter the non-prod
    // candidate out and resolve the token unambiguously to the single
    // prod-eligible service.
    //   - Service X ("svc-x", probe.prod:true) has dispatchName "shared" →
    //     renders + emits token "shared".
    //   - Service Y ("shared", probe.prod:false) has name "shared" → would
    //     match token "shared" by name, but is filtered out by the prod guard.
    // Under an all-services match filter, token "shared" would resolve to 2
    // services (X by dispatchName, Y by name) and THROW (false positive). With
    // the probe.prod restriction it resolves to exactly 1 (X) and must pass.
    const prodFilteredMap: typeof SERVICES = {
      // renders + emits token "shared"
      "svc-x": mkEntry("x", { dispatchName: "shared" }),
      // name "shared" collides with X's emitted token, but probe.prod:false
      // means the resolve step (and now the guard) filters it out.
      shared: mkEntry("shared", { prodProbe: false }),
    };
    // The guard must NOT throw: X resolves uniquely once Y is excluded.
    expect(() => computeOptionTokens(prodFilteredMap)).not.toThrow();
    // X's token IS emitted; the prod:false service Y never appears.
    const tokens = computeOptionTokens(prodFilteredMap);
    expect(tokens).toContain("shared");
    expect(tokens).toEqual([SENTINEL, "all", "shared"]);
  });

  it("throws (fail loud) when a real-service token collides with a reserved literal", () => {
    // A service whose rendered token is exactly "all" (the explicit
    // whole-fleet literal). If allowed through it would emit a SECOND `- all`
    // option and masquerade as the reserved value the resolve step
    // special-cases. The generator must fail loud, naming the offender.
    const reservedCollisionMap: typeof SERVICES = {
      // collides with the reserved "all" literal
      delta: mkEntry("delta", { dispatchName: "all" }),
    };
    expect(() => computeOptionTokens(reservedCollisionMap)).toThrow(
      /reserved literal/,
    );
    expect(() => computeOptionTokens(reservedCollisionMap)).toThrow(/"all"/);
  });
});

describe("sync-promote-service-options", () => {
  let workDir: string;
  let wfPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "sync-promote-"));
    wfPath = join(workDir, "showcase_promote.yml");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("rewrites a drifted options block to the exact expected ordered list", () => {
    // Seed with deliberately wrong/stale content inside the markers.
    writeFileSync(
      wfPath,
      fixture(
        [
          "        default: all",
          "        options:",
          "          - all",
          "          - bogus-stale-entry",
        ].join("\n"),
      ),
    );
    execFileSync("npx", ["tsx", SCRIPT, `--workflow=${wfPath}`], {
      stdio: "pipe",
    });
    const after = readFileSync(wfPath, "utf8");
    const doc = parseYaml(after);
    const input = doc.on.workflow_dispatch.inputs.service;
    // The rendered dropdown is the FULL, ordered token list: SENTINEL, then
    // "all", then every probe.prod service rendered as (dispatchName ?? name)
    // and sorted ALPHABETICALLY BY RENDERED TOKEN (not by SSOT key). Deep-equal
    // against the generator's own output so the test tracks the SSOT and the
    // token-sort order exactly.
    expect(input.options).toEqual(computeOptionTokens(SERVICES));
    expect(input.options[0]).toBe("__select_a_service__");
    expect(input.options[1]).toBe("all");
    expect(input.default).toBe("__select_a_service__");
    expect(input.options).toContain("ag2");
    // pocketbase now defines dispatchName "showcase-pocketbase", so the
    // rendered token is the dispatchName, not the bare SSOT key.
    expect(input.options).toContain("showcase-pocketbase");
    expect(input.options).not.toContain("bogus-stale-entry");
    // dispatchName tokens, not SSOT keys, for services that define one.
    expect(input.options).not.toContain("showcase-ag2");
  });

  it("is idempotent: a second run is byte-identical and --check exits 0", () => {
    writeFileSync(wfPath, fixture("        default: all\n        options:"));
    execFileSync("npx", ["tsx", SCRIPT, `--workflow=${wfPath}`], {
      stdio: "pipe",
    });
    const first = readFileSync(wfPath, "utf8");
    execFileSync("npx", ["tsx", SCRIPT, `--workflow=${wfPath}`], {
      stdio: "pipe",
    });
    const second = readFileSync(wfPath, "utf8");
    expect(second).toBe(first);
    const check = spawnSync(
      "npx",
      ["tsx", SCRIPT, "--check", `--workflow=${wfPath}`],
      { encoding: "utf8" },
    );
    expect(check.status).toBe(0);
  });

  it("--check exits 1 on drift with the re-run diagnostic", () => {
    writeFileSync(
      wfPath,
      fixture(
        ["        default: all", "        options:", "          - all"].join(
          "\n",
        ),
      ),
    );
    const result = spawnSync(
      "npx",
      ["tsx", SCRIPT, "--check", `--workflow=${wfPath}`],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/sync-promote-service-options/);
    expect(result.stderr).toMatch(/re-run/i);
  });

  it("places the sentinel as option[0] and sets default to the sentinel", () => {
    writeFileSync(wfPath, fixture("        options:"));
    execFileSync("npx", ["tsx", SCRIPT, `--workflow=${wfPath}`], {
      stdio: "pipe",
    });
    const doc = parseYaml(readFileSync(wfPath, "utf8"));
    const input = doc.on.workflow_dispatch.inputs.service;
    expect(input.options[0]).toBe("__select_a_service__");
    expect(input.default).toBe("__select_a_service__");
  });

  it("fails loud (non-zero) when markers are missing — no silent rewrite", () => {
    const noMarkers = [
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      service:",
      '        description: "Service to promote"',
      "        type: choice",
      "",
    ].join("\n");
    writeFileSync(wfPath, noMarkers);
    const result = spawnSync("npx", ["tsx", SCRIPT, `--workflow=${wfPath}`], {
      encoding: "utf8",
    });
    // Render error → exit 3, with the SPECIFIC "not found" diagnostic.
    expect(result.status).toBe(3);
    expect(result.stderr).toContain(DIAG_NOT_FOUND);
    expect(result.stderr).not.toContain(DIAG_DUPLICATE);
    expect(result.stderr).not.toContain(DIAG_OUT_OF_ORDER);
    // The file must be untouched (no silent rewrite of the wrong region).
    expect(readFileSync(wfPath, "utf8")).toBe(noMarkers);
  });

  it("fails loud when markers are duplicated", () => {
    const dup = [
      "      service:",
      "        type: choice",
      `        ${BEGIN}`,
      "        options:",
      `        ${END}`,
      "      other:",
      "        type: choice",
      `        ${BEGIN}`,
      "        options:",
      `        ${END}`,
      "",
    ].join("\n");
    writeFileSync(wfPath, dup);
    const result = spawnSync("npx", ["tsx", SCRIPT, `--workflow=${wfPath}`], {
      encoding: "utf8",
    });
    // Render error → exit 3, with the SPECIFIC "duplicate" diagnostic.
    expect(result.status).toBe(3);
    expect(result.stderr).toContain(DIAG_DUPLICATE);
    expect(result.stderr).not.toContain(DIAG_NOT_FOUND);
    expect(result.stderr).not.toContain(DIAG_OUT_OF_ORDER);
    expect(readFileSync(wfPath, "utf8")).toBe(dup);
  });

  it("fails loud when markers are out of order (END before BEGIN)", () => {
    // Exactly one BEGIN and one END, but END appears FIRST. This must be
    // distinguished from "not found" and "duplicate" with its own diagnostic.
    const outOfOrder = [
      "      service:",
      "        type: choice",
      `        ${END}`,
      "        options:",
      `        ${BEGIN}`,
      "",
    ].join("\n");
    writeFileSync(wfPath, outOfOrder);
    const result = spawnSync("npx", ["tsx", SCRIPT, `--workflow=${wfPath}`], {
      encoding: "utf8",
    });
    // Render error → nonzero exit 3, with the SPECIFIC "malformed" diagnostic.
    expect(result.status).toBe(3);
    expect(result.stderr).toContain(DIAG_OUT_OF_ORDER);
    expect(result.stderr).not.toContain(DIAG_NOT_FOUND);
    expect(result.stderr).not.toContain(DIAG_DUPLICATE);
    // The file must be left untouched.
    expect(readFileSync(wfPath, "utf8")).toBe(outOfOrder);
  });

  it("exits 2 on a read error (nonexistent --workflow path)", () => {
    const missingPath = join(workDir, "does-not-exist.yml");
    const result = spawnSync(
      "npx",
      ["tsx", SCRIPT, `--workflow=${missingPath}`],
      { encoding: "utf8" },
    );
    // ALL read failures, including a missing file, exit 2 (not 3).
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("failed to read");
  });

  it("rejects an unknown flag (fail loud, exit 2) instead of silently writing", () => {
    // Seed a valid workflow so the ONLY reason to fail is the bad arg — a
    // typo like `--chek` must NOT silently fall through to a destructive
    // write of the real workflow.
    writeFileSync(wfPath, fixture("        options:"));
    const before = readFileSync(wfPath, "utf8");
    const result = spawnSync(
      "npx",
      ["tsx", SCRIPT, "--chek", `--workflow=${wfPath}`],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown argument: --chek");
    // The file is untouched — no silent write happened.
    expect(readFileSync(wfPath, "utf8")).toBe(before);
  });

  it("rejects an empty --workflow= value (fail loud, exit 2)", () => {
    const result = spawnSync("npx", ["tsx", SCRIPT, "--workflow="], {
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--workflow= requires a path value");
  });

  it("rejects a bare --workflow with no value (fail loud, exit 2)", () => {
    const result = spawnSync("npx", ["tsx", SCRIPT, "--workflow", wfPath], {
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--workflow requires a value");
  });

  it("rejects a duplicate --workflow= (fail loud, exit 2)", () => {
    const other = join(workDir, "other.yml");
    const result = spawnSync(
      "npx",
      ["tsx", SCRIPT, `--workflow=${wfPath}`, `--workflow=${other}`],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--workflow may only be supplied once");
  });

  it("preserves content outside the markers and keeps valid YAML", () => {
    writeFileSync(wfPath, fixture("        options:"));
    execFileSync("npx", ["tsx", SCRIPT, `--workflow=${wfPath}`], {
      stdio: "pipe",
    });
    const after = readFileSync(wfPath, "utf8");
    // Surrounding structure is intact.
    expect(after).toContain('name: "Showcase: Promote (staging → prod)"');
    expect(after).toContain("      digest:");
    expect(after).toContain("  resolve-targets:");
    // Still parses, and the digest input is untouched.
    const doc = parseYaml(after);
    expect(doc.on.workflow_dispatch.inputs.digest.type).toBe("string");
    expect(doc.on.workflow_dispatch.inputs.service.type).toBe("choice");
  });

  it("importing the module does NOT trigger main() (import.meta.url guard)", () => {
    // Spawn a tsx process whose entrypoint is an ESM eval that dynamically
    // IMPORTS the module — so process.argv[1] is the eval shim, NOT the module
    // path. The `import.meta.url` guard must therefore see argv[1] !== its own
    // URL and skip main(). If the guard were broken, main() would run on
    // import, read the DEFAULT workflow path, and print "wrote ..."/"already
    // up to date." We assert no such generator output appears, and that the
    // import itself completes (the sentinel prints AFTER the await).
    const importer = join(workDir, "importer.mjs");
    // Point at the .ts source via a file:// URL so tsx transpiles it on import.
    const scriptUrl = `file://${SCRIPT}`;
    writeFileSync(
      importer,
      [
        `await import(${JSON.stringify(scriptUrl)});`,
        `process.stdout.write("IMPORT_OK\\n");`,
      ].join("\n"),
    );
    const result = spawnSync("npx", ["tsx", importer], {
      encoding: "utf8",
      cwd: workDir,
    });
    // The import completed cleanly...
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    // ...and main() never ran: none of its stdout/stderr signatures appear.
    expect(result.stdout).not.toMatch(/^wrote /m);
    expect(result.stdout).not.toContain("already up to date");
    expect(result.stdout).not.toContain("up to date.");
    expect(result.stderr).not.toContain("failed to read");
  });

  it("every generated token round-trips to exactly ONE SSOT service (resolve-step contract)", () => {
    const tokens = computeOptionTokens(SERVICES);
    // The literals the resolve step special-cases; they must never collide
    // with a real service token.
    const reserved = new Set([SENTINEL, "all"]);

    for (const token of tokens) {
      if (reserved.has(token)) continue;

      // The SAME predicate the workflow's resolve step uses to map a chosen
      // dropdown token back to an SSOT service, applied EXACTLY:
      //   (.name === token || .dispatchName === token) && .probe.prod === true
      // The resolve step is `select(.name == $s or .dispatchName == $s) |
      // select(.probe.prod == true)`, so the `probe.prod === true` filter is a
      // load-bearing term of the predicate, NOT a redundant one we can omit.
      // Including it here keeps this round-trip check identical to both the
      // resolve step and the generator's own uniqueness guard: a future
      // non-prod service sharing a name/dispatchName token with a prod-eligible
      // service would resolve unambiguously to the single prod-eligible service
      // (the non-prod candidate is filtered out), so it must NOT be counted as
      // an ambiguous match here either.
      const matches = Object.entries(SERVICES).filter(
        ([name, entry]) =>
          // Mirror the generator's isProdPromotable: declares a prod env
          // whose probe is enabled (probe defaults to true when omitted).
          entry.environments.prod !== undefined &&
          (entry.environments.prod.probe ?? true) === true &&
          (name === token || entry.dispatchName === token),
      );
      // Exactly ONE service resolves from each generated token — no ambiguity,
      // no orphans. This pins the generator↔resolve contract.
      expect(
        matches.length,
        `token "${token}" should resolve to exactly one service, got ${matches.length}`,
      ).toBe(1);
    }

    // No real-service token may masquerade as a reserved literal. The loop
    // above `continue`s on reserved tokens, so it can never observe this —
    // assert it DIRECTLY against the SSOT instead: iterate every real
    // service, render its token exactly as computeOptionTokens does
    // (dispatchName ?? key), and require none equals "all" or SENTINEL.
    for (const [name, entry] of Object.entries(SERVICES)) {
      const rendered = entry.dispatchName ?? name;
      expect(
        rendered,
        `SSOT service "${name}" renders token "${rendered}", which collides with reserved literal SENTINEL`,
      ).not.toBe(SENTINEL);
      expect(
        rendered,
        `SSOT service "${name}" renders token "${rendered}", which collides with reserved literal "all"`,
      ).not.toBe("all");
    }

    // Sanity: the reserved literals appear exactly once each, in order.
    expect(tokens[0]).toBe(SENTINEL);
    expect(tokens[1]).toBe("all");
    expect(tokens.filter((t) => t === SENTINEL)).toHaveLength(1);
    expect(tokens.filter((t) => t === "all")).toHaveLength(1);
  });
});

describe("promote dropdown regression guard (shell-docs + starters must stay listed)", () => {
  // The whole set the dropdown must currently expose, computed from the SSOT.
  // Used as the "no previously-listed target is dropped" oracle: every token
  // the generator currently emits (minus the two reserved literals) MUST
  // survive in both the generator output and the committed workflow file.
  const expectedTokens = computeOptionTokens(SERVICES);
  const expectedRealTargets = expectedTokens.filter(
    (t) => t !== SENTINEL && t !== "all",
  );

  it("generator output contains shell-docs AND all 12 starters by name", () => {
    const tokens = computeOptionTokens(SERVICES);
    // Assert MEMBERSHIP by name (not just a count) so a regression that swaps
    // one target for another is still caught.
    for (const required of REQUIRED_PROMOTE_TARGETS) {
      expect(
        tokens,
        `promote dropdown (generator output) must contain "${required}" — ` +
          `it is a required promote target and must never be dropped`,
      ).toContain(required);
    }
  });

  it("the COMMITTED showcase_promote.yml choice list contains shell-docs AND all 12 starters", () => {
    // This is the file GitHub validates the choice enum against server-side.
    // If shell-docs or any starter is absent here, `gh workflow run
    // showcase_promote.yml -f service=<svc>` is rejected with HTTP 422 even
    // though the SSOT lists the service. Asserting the COMMITTED file (not
    // just the in-memory generator output) is what makes this guard real:
    // it fails if the dropdown is ever left un-regenerated after an SSOT change.
    const doc = parseYaml(readFileSync(COMMITTED_WORKFLOW, "utf8"));
    const options: string[] = doc.on.workflow_dispatch.inputs.service.options;

    for (const required of REQUIRED_PROMOTE_TARGETS) {
      expect(
        options,
        `committed showcase_promote.yml service dropdown must contain ` +
          `"${required}" (GitHub validates the choice enum against this file; ` +
          `a missing value yields HTTP 422 on dispatch)`,
      ).toContain(required);
    }
  });

  it("the committed dropdown is the EXACT union — drops no previously-listed target", () => {
    // The committed file must equal the generator's full output, guaranteeing
    // the fix is purely additive: every service the generator emits (the union
    // of shell-docs, the starters, and every pre-existing target) is present,
    // in order, with nothing removed.
    const doc = parseYaml(readFileSync(COMMITTED_WORKFLOW, "utf8"));
    const options: string[] = doc.on.workflow_dispatch.inputs.service.options;

    // Nothing the generator currently emits may be missing from the committed
    // file — this is the "never drop an existing target" invariant.
    for (const target of expectedRealTargets) {
      expect(
        options,
        `committed dropdown dropped previously-listed promote target ` +
          `"${target}"`,
      ).toContain(target);
    }

    // And the committed list is byte-for-byte the generator's output, so the
    // dropdown can never silently drift from the SSOT in either direction.
    expect(options).toEqual(expectedTokens);
  });
});
