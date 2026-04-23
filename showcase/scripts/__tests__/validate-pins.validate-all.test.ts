// Split from validate-pins.test.ts — see validate-pins.shared.ts header
// for the full rationale (vitest birpc 60s cliff, fork-per-file).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  collectDojoDeps,
  collectShowcaseDeps,
  validateAll,
  isMainPath,
  parsePackageJson,
} from "../validate-pins.js";
import { tmpdir, write, withTmp } from "./validate-pins.shared.js";

describe("Unpinned spec rejection in validateAll", () => {
  let repoRoot: string;
  // Save-and-restore pattern for VALIDATE_PINS_REPO_ROOT so that if the
  // env var was set at suite entry (e.g. by an outer invocation), it's
  // preserved rather than silently deleted. No tests in this describe
  // call process.chdir(), so cwd does not need save/restore either.
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;

    // Build minimal examples/integrations + showcase/packages pair.
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
  });

  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("FAILs when both sides have same non-exact spec (e.g. 'next')", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);

    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "next" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "next" },
      }),
    );

    const report = validateAll();
    // assert against the specific slug + dep name + message fragment.
    const matching = report.fail.filter(
      (l) =>
        l.includes(`[FAIL] ${slug}:`) &&
        l.includes("@mastra/core") &&
        /non-exact/i.test(l),
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  it("FAILs when both sides have '^1.0.0'", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);

    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "^1.0.0" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "^1.0.0" },
      }),
    );

    const report = validateAll();
    // specific slug + dep + expected message fragment.
    const matching = report.fail.filter(
      (l) =>
        l.includes(`[FAIL] ${slug}:`) &&
        l.includes("@mastra/core") &&
        /non-exact/i.test(l),
    );
    expect(matching.length).toBeGreaterThan(0);
  });
});
describe("collectDojoDeps precedence", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = tmpdir();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("apps/agent/package.json wins over root package.json for shared deps", () => {
    // Root pins an older version, agent pins the actual version.
    write(
      path.join(tmp, "package.json"),
      JSON.stringify({
        name: "example-root",
        dependencies: { "@langchain/langgraph": "0.1.0" },
      }),
    );
    write(
      path.join(tmp, "apps", "agent", "package.json"),
      JSON.stringify({
        name: "example-agent",
        dependencies: { "@langchain/langgraph": "0.2.14" },
      }),
    );

    const { jsDeps } = collectDojoDeps(tmp);
    expect(jsDeps["@langchain/langgraph"]).toBe("0.2.14");
  });

  it("agent/pyproject.toml wins over root pyproject.toml", () => {
    write(
      path.join(tmp, "pyproject.toml"),
      '[project]\nname = "root"\ndependencies = ["langgraph==0.1.0"]\n',
    );
    write(
      path.join(tmp, "agent", "pyproject.toml"),
      '[project]\nname = "agent"\ndependencies = ["langgraph==0.2.14"]\n',
    );
    const { pythonDeps } = collectDojoDeps(tmp);
    expect(pythonDeps["langgraph"]).toBe("==0.2.14");
  });

  // three-way first-writer-wins root + apps/agent + apps/web.
  it("root + apps/agent + apps/web: apps/agent wins for shared deps", () => {
    write(
      path.join(tmp, "package.json"),
      JSON.stringify({
        name: "root",
        dependencies: { foo: "0.0.1" },
      }),
    );
    write(
      path.join(tmp, "apps", "agent", "package.json"),
      JSON.stringify({
        name: "agent",
        dependencies: { foo: "0.0.2" },
      }),
    );
    write(
      path.join(tmp, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { foo: "0.0.3" },
      }),
    );
    const { jsDeps } = collectDojoDeps(tmp);
    // apps/agent is walked first in DEP_FILE_CANDIDATES → wins.
    expect(jsDeps["foo"]).toBe("0.0.2");
  });

  // parse-error resilience — one bad sibling doesn't abort.
  it("continues past a bad pyproject to parse the sibling package.json", () => {
    write(
      path.join(tmp, "pyproject.toml"),
      // Missing ] closer is fatal at the parse level.
      '[project]\nname = "broken"\ndependencies = [\n  "foo==1.0"\n',
    );
    write(
      path.join(tmp, "apps", "agent", "package.json"),
      JSON.stringify({
        name: "agent",
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    const { jsDeps, parseErrors } = collectDojoDeps(tmp);
    expect(parseErrors.length).toBeGreaterThan(0);
    // Sibling still parsed.
    expect(jsDeps["@mastra/core"]).toBe("0.15.0");
  });
});
describe("validateAll cross-drift detection", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
  });

  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("FAILs when a framework dep is pinned in Dojo but absent in showcase", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);

    // Showcase: missing @mastra/core entirely.
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: slug, dependencies: { react: "18.0.0" } }),
    );
    // Dojo: pins @mastra/core.
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );

    const report = validateAll();
    // specific slug + dep + "absent".
    const matching = report.fail.filter(
      (l) =>
        l.includes(`[FAIL] ${slug}:`) &&
        l.includes("@mastra/core") &&
        /absent/i.test(l),
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  it("uses PEP 503 canonicalization across hyphens/underscores", () => {
    const slug = "langgraph-python";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);

    // Showcase uses underscores, Dojo uses hyphens. Versions differ — must FAIL.
    write(
      path.join(pkgDir, "requirements.txt"),
      "langgraph_checkpoint==0.1.0\n",
    );
    write(
      path.join(exDir, "requirements.txt"),
      "langgraph-checkpoint==0.2.0\n",
    );

    const report = validateAll();
    // assert on the slug + message framing.
    const matching = report.fail.filter(
      (l) =>
        l.includes(`[FAIL] ${slug}:`) &&
        /langgraph[-_]checkpoint/.test(l) &&
        (/0\.1\.0/.test(l) || /0\.2\.0/.test(l)),
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  // exact-pin match both sides → OK, no FAIL.
  it("emits [OK] when exact pins match both sides", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    const report = validateAll();
    expect(report.ok.some((l) => l.includes(slug))).toBe(true);
    expect(
      report.fail.some((l) => l.includes(slug) && l.includes("@mastra/core")),
    ).toBe(false);
  });

  // zero dep files on showcase side is a STRUCTURAL error. A
  // showcase package without any declared dependencies cannot
  // demonstrate a framework integration, so it must FAIL (not WARN) so
  // CI catches the omission.
  it("FAILs (not WARNs) when showcase package has zero dep files", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    // Showcase package exists as a directory but has NO dep files.
    fs.mkdirSync(pkgDir, { recursive: true });
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    const report = validateAll();
    const failed = report.fail.some(
      (l) =>
        l.includes(slug) && /no dependency files found in showcase/i.test(l),
    );
    expect(failed).toBe(true);
    // BORN_IN_SHOWCASE is the only case where a showcase package is
    // allowed to have no dep files (since it might have no Dojo
    // counterpart); that path is handled before we reach this check.
  });

  // `workspace:*` refs (and variants) have no published-pin
  // semantics. They must be routed to [SKIP], not [FAIL] — otherwise
  // intra-monorepo showcase packages emit spurious pin-drift FAILs.
  it("workspace:* spec emits [SKIP], not [FAIL]", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);

    // Showcase pins a workspace ref, Dojo pins an exact version. This
    // used to surface as a "non-exact spec" FAIL on the showcase side;
    // workspace refs are out-of-scope for pin checks.
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@copilotkit/react-core": "workspace:*" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@copilotkit/react-core": "1.10.0" },
      }),
    );
    const report = validateAll();
    const skipped = report.skip.some(
      (l) =>
        l.includes(slug) &&
        l.includes("@copilotkit/react-core") &&
        /workspace/i.test(l),
    );
    expect(skipped).toBe(true);
    const failed = report.fail.some(
      (l) => l.includes(slug) && l.includes("@copilotkit/react-core"),
    );
    expect(failed).toBe(false);
  });

  it("workspace:^ spec emits [SKIP] when both sides use workspace refs", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@copilotkit/react-core": "workspace:^" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@copilotkit/react-core": "workspace:*" },
      }),
    );
    const report = validateAll();
    expect(
      report.skip.some(
        (l) =>
          l.includes(slug) &&
          l.includes("@copilotkit/react-core") &&
          /workspace/i.test(l),
      ),
    ).toBe(true);
    expect(
      report.fail.some(
        (l) => l.includes(slug) && l.includes("@copilotkit/react-core"),
      ),
    ).toBe(false);
  });

  // BORN_IN_SHOWCASE slug must produce a [SKIP] entry, not FAIL/WARN.
  it("emits [SKIP] for born-in-showcase slugs", () => {
    // ag2 is in BORN_IN_SHOWCASE.
    const slug = "ag2";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    fs.mkdirSync(pkgDir, { recursive: true });
    const report = validateAll();
    expect(
      report.skip.some((l) => l.includes(slug) && /born-in-showcase/i.test(l)),
    ).toBe(true);
    expect(report.fail.some((l) => l.includes(slug))).toBe(false);
    expect(report.warn.some((l) => l.includes(slug))).toBe(false);
  });
});
describe("isMainPath strict guard", () => {
  it("returns false for paths that merely contain 'validate-pins' substring", () => {
    // e.g. a test runner path that mentions validate-pins
    expect(
      isMainPath(
        "/some/path/to/validate-pins.test.ts",
        "/other/validate-pins.ts",
      ),
    ).toBe(false);
  });

  it("returns true for an exact match", () => {
    const scriptPath = "/abs/path/validate-pins.ts";
    expect(isMainPath(scriptPath, scriptPath)).toBe(true);
  });

  // isMainPath(undefined, ...) must return false, not crash.
  it("returns false for undefined argv1", () => {
    expect(isMainPath(undefined, "/any/path.ts")).toBe(false);
  });

  // Catch branch: if `path.resolve` throws for any reason we must log,
  // set process.exitCode = EXIT_INTERNAL (2), and return false — NOT
  // crash, and NOT silently swallow. The bare-catch form would pass
  // arg-validation tests but mask real bugs. Spying on path.resolve
  // exercises the branch directly without needing to contrive a
  // real-world input that makes Node throw.
  it("catch branch: path.resolve failure logs, sets exitCode = 2, returns false", () => {
    const prevExitCode = process.exitCode;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Use `mockImplementation` (not `mockImplementationOnce`) so every
    // path.resolve call inside isMainPath throws, regardless of how
    // many times the implementation invokes it. With `Once`, an
    // implementation that resolves twice would pass the first throw,
    // succeed on the second resolve, and return `false` for the wrong
    // reason (unrelated mismatch rather than the catch branch we're
    // trying to exercise).
    const resolveSpy = vi.spyOn(path, "resolve").mockImplementation(() => {
      throw new Error("synthetic path.resolve failure");
    });
    try {
      // Explicit contract: when resolve throws, isMainPath must return
      // false (not crash, not return true). Pair this with the exitCode
      // + logging assertions below so the catch branch is pinned on all
      // three observable side effects.
      expect(isMainPath("/any/path.ts", "/any/path.ts")).toBe(false);
      expect(process.exitCode).toBe(2);
      expect(errSpy).toHaveBeenCalled();
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toMatch(/\[isMainPath\] path\.resolve failed/);
    } finally {
      // Restore so a later test doesn't inherit exitCode = 2 and
      // mark the whole suite as failed.
      process.exitCode = prevExitCode;
      resolveSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
describe("FALLBACK_MAP fallthrough when target missing", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
  });

  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("emits WARN instead of silently dropping when FALLBACK target missing", () => {
    const slug = "strands"; // FALLBACK_MAP points to strands-python
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    // Deliberately DO NOT create strands-python under examples/integrations
    // Showcase has a package.json so it's not an empty package.
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: slug, dependencies: {} }),
    );

    const report = validateAll();
    // Expect some WARN to call out that the FALLBACK target is missing.
    const warned = report.warn.some(
      (l) => l.includes(slug) && /fallback/i.test(l),
    );
    expect(warned).toBe(true);
  });

  // The missingFallbackTarget path must render relative to REPO_ROOT,
  // i.e. starting with `examples/integrations/`, so the WARN line
  // names the full expected location rather than an ambiguous
  // `integrations/<name>` that hides the `examples/` prefix.
  it("missingFallbackTarget path renders relative to REPO_ROOT", () => {
    const slug = "strands"; // FALLBACK_MAP points to strands-python
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: slug, dependencies: {} }),
    );
    const report = validateAll();
    const warn = report.warn.find(
      (l) => l.includes(slug) && /fallback/i.test(l),
    );
    expect(warn).toBeDefined();
    // Must NOT show the confusing `integrations/strands-python` form.
    expect(warn).not.toMatch(/'integrations\//);
    // Must show the full `examples/integrations/strands-python` path.
    expect(warn).toMatch(/examples\/integrations\/strands-python/);
  });
});
describe("FAIL/WARN go to stderr", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("routes [FAIL] lines through console.error", async () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);

    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.16.0" },
      }),
    );

    const { printReport } = await import("../validate-pins.js");
    printReport(validateAll());

    const errorCalls = stderrSpy.mock.calls.flat().join("\n");
    expect(errorCalls).toMatch(/\[FAIL\]/);
  });

  // a parse error must produce EXACTLY ONE [FAIL] line (no
  // immediate console.error at [parse-error] AND another [FAIL] —
  // that was double-logging).
  it("emits a single [FAIL] per parse error (no double-log)", async () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    write(path.join(pkgDir, "package.json"), "{ not valid json");
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    const report = validateAll();
    const parseFails = report.fail.filter(
      (l) => l.includes(slug) && /parse error/i.test(l),
    );
    // One broken file → exactly one FAIL. Previously the code logged
    // `[parse-error]` directly AND pushed a `[FAIL]`, producing two.
    expect(parseFails.length).toBe(1);

    // And before building the report, no immediate `[parse-error]`
    // console.error should have been emitted by collectors. The only
    // stderr write comes from printReport emitting [FAIL] lines.
    const preReportStderr = stderrSpy.mock.calls.flat().join("\n");
    expect(preReportStderr).not.toMatch(/\[parse-error\]/);
  });
});
describe("validateAll exit-code integration", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
  });

  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  // missing PACKAGES_DIR must not result in a green exit. A missing
  // packages dir is a repo-structure / configuration problem rather
  // than real drift, so the validator throws UnreadableInputError
  // (→ EXIT_UNREADABLE, 3) instead of emitting a report.fail entry
  // (→ EXIT_DRIFT, 1). This keeps the two exit-code buckets clean
  // for CI triage.
  it("missing packages dir throws UnreadableInputError (exit 3, not drift)", () => {
    // Do NOT create showcase/packages.
    expect(() => validateAll()).toThrow(/Packages dir not found/);
  });

  // empty PACKAGES_DIR is the same class of error as missing — also
  // a config / checkout problem, not drift. Route through
  // UnreadableInputError for EXIT_UNREADABLE (3).
  it("empty packages dir throws UnreadableInputError (exit 3, not drift)", () => {
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    expect(() => validateAll()).toThrow(
      /No showcase packages discovered under/,
    );
  });

  // parse errors must produce a FAIL (force non-zero exit).
  it("parse errors produce a FAIL (not just a WARN)", () => {
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    // Deliberately broken JSON.
    write(path.join(pkgDir, "package.json"), "{ not valid json");
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );

    const report = validateAll();
    const parseFail = report.fail.some((l) => /parse error/i.test(l));
    expect(parseFail).toBe(true);
  });

  // when files existed but ALL parse-errored, do not ALSO emit the
  // "no dependency files found" message (it's confusing double-reporting).
  // The "no dep files" line is a FAIL rather than a WARN,
  // so we assert on .fail here too.
  it("all-files-parse-error must not produce a 'no dep files' message", () => {
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    // Showcase: ONLY file is broken JSON.
    write(path.join(pkgDir, "package.json"), "{ not valid json");
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    const report = validateAll();
    const noFilesLine = [...report.fail, ...report.warn].some(
      (l) =>
        l.includes(slug) && /no dependency files found in showcase/i.test(l),
    );
    expect(noFilesLine).toBe(false);
    // But the parse FAIL is still present.
    expect(
      report.fail.some((l) => l.includes(slug) && /parse error/i.test(l)),
    ).toBe(true);
  });

  // apps/web/package.json in showcase should be scanned.
  it("apps/web/package.json in a showcase package is scanned", () => {
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);

    // Showcase package has only apps/web/package.json (no root, no agent).
    write(
      path.join(pkgDir, "apps", "web", "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    // Dojo matches.
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );

    const report = validateAll();
    // Should NOT say "no dependency files found in showcase package".
    const noFiles = report.warn.some(
      (l) =>
        l.includes(slug) && /no dependency files found in showcase/i.test(l),
    );
    expect(noFiles).toBe(false);
  });

  // JS dep names must NOT be Python-canonicalized. Mixed separators
  // in npm names like `@mastra/foo.bar` vs `@mastra/foo-bar` are DIFFERENT
  // packages and must not be collapsed.
  it("JS package.json deps are compared without Python canonicalization", () => {
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);

    // With isPython=true hardcoded for JS deps, these names would collapse
    // to the same canonical key and specs get compared incorrectly,
    // producing a spurious drift FAIL between 0.15.0 and 0.16.0.
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/foo.bar": "0.15.0" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/foo-bar": "0.16.0" },
      }),
    );

    const report = validateAll();
    // Under correct JS-side semantics, these are distinct packages. The
    // `foo.bar`/`foo-bar` names don't match any framework pattern, so
    // there should be NO drift FAIL linking them together.
    const incorrectMerge = report.fail.some(
      (l) =>
        /foo\.bar|foo-bar/.test(l) &&
        /(0\.15\.0.*0\.16\.0|0\.16\.0.*0\.15\.0)/.test(l),
    );
    expect(incorrectMerge).toBe(false);
  });

  // framework detection must canonicalize the name before the pattern
  // check so PEP 503 variants (mixed case) are still recognized.
  it("framework detection recognizes mixed-case Python framework names", () => {
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    const slug = "langgraph-python";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);

    // Showcase uses mixed-case `LangGraph` (valid Python distribution name
    // since PEP 503 normalizes to lowercase). Dojo uses lowercase. Versions
    // differ — must FAIL. This only works if framework detection
    // canonicalizes the name on both sides before testing patterns.
    write(path.join(pkgDir, "requirements.txt"), "LangGraph==0.2.10\n");
    write(path.join(exDir, "requirements.txt"), "langgraph==0.2.14\n");

    const report = validateAll();
    const flagged = report.fail.some(
      (l) => l.includes(slug) && /langgraph/i.test(l),
    );
    expect(flagged).toBe(true);
  });
});
describe("computeRepoRoot env override validation", () => {
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
  });

  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
  });

  it("throws when VALIDATE_PINS_REPO_ROOT is a relative path", () => {
    process.env.VALIDATE_PINS_REPO_ROOT = "relative/path";
    // validateAll ultimately calls paths() which calls computeRepoRoot.
    expect(() => validateAll()).toThrow(/absolute/i);
  });

  it("throws when VALIDATE_PINS_REPO_ROOT does not exist", () => {
    process.env.VALIDATE_PINS_REPO_ROOT = "/nonexistent/path/xyz123";
    expect(() => validateAll()).toThrow(/does not exist/i);
  });
});
describe("Dojo workspace ref absent in showcase -> WARN", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
  });
  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("emits WARN (not SKIP) when Dojo uses workspace:* and showcase has no entry", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    // Showcase has NO @copilotkit/react-core at all.
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    // Dojo has a workspace ref for @copilotkit/react-core.
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: {
          "@copilotkit/react-core": "workspace:*",
          "@mastra/core": "0.15.0",
        },
      }),
    );

    const report = validateAll();
    const warned = report.warn.some(
      (l) =>
        l.includes(slug) &&
        l.includes("@copilotkit/react-core") &&
        /absent/i.test(l),
    );
    expect(warned).toBe(true);
    const skippedForThisDep = report.skip.some(
      (l) => l.includes(slug) && l.includes("@copilotkit/react-core"),
    );
    expect(skippedForThisDep).toBe(false);
  });
});
describe("workspace ref on showcase echoes Dojo pin in SKIP", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
  });
  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("SKIP message includes the Dojo pin when showcase is workspace ref", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@copilotkit/react-core": "workspace:*" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@copilotkit/react-core": "1.10.0" },
      }),
    );
    const report = validateAll();
    const match = report.skip.find(
      (l) => l.includes(slug) && l.includes("@copilotkit/react-core"),
    );
    expect(match).toBeDefined();
    // Both workspace ref AND Dojo pin visible in the line.
    expect(match).toMatch(/workspace:\*/);
    expect(match).toMatch(/1\.10\.0/);
  });
});
describe("JS deps with framework-matching names are NOT PEP 503 canonicalized", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
  });
  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("distinct JS packages `@copilotkit/react-core.ext` vs `@copilotkit/react-core-ext` do NOT collide", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@copilotkit/react-core.ext": "1.10.0" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@copilotkit/react-core-ext": "1.11.0" },
      }),
    );
    const report = validateAll();
    // These are SEPARATE npm packages. If PEP 503 canonicalization
    // were wrongly applied to JS names, they would collapse and
    // produce a spurious drift FAIL between 1.10.0 and 1.11.0.
    const wrongMerge = report.fail.some(
      (l) =>
        /react-core[.-]ext/.test(l) &&
        /(1\.10\.0.*1\.11\.0|1\.11\.0.*1\.10\.0)/.test(l),
    );
    expect(wrongMerge).toBe(false);
  });
});
describe("no [parse-error] in pre-report stderr (extended with printReport)", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("never emits [parse-error] on stderr across collect + printReport", async () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    write(path.join(pkgDir, "package.json"), "{ not valid json");
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    const { printReport } = await import("../validate-pins.js");
    const report = validateAll();
    printReport(report);
    const allStderr = stderrSpy.mock.calls.flat().join("\n");
    const parseErrorCount = (allStderr.match(/\[parse-error\]/g) ?? []).length;
    expect(parseErrorCount).toBe(0);
  });
});
describe("parseErrors suppress the OK line for a slug", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
  });
  afterEach(() => {
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("does not emit [OK] for a slug with a mix of valid + parse-errored showcase files", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    // Valid root package.json — so `showcase.files.length > 0` and we
    // do NOT hit the `files.length === 0` early-continue path. The
    // malformed apps/agent/package.json still produces a parseError.
    write(
      path.join(pkgDir, "apps", "agent", "package.json"),
      "{ not valid json",
    );
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );

    const report = validateAll();
    const okForSlug = report.ok.some((l) => l.includes(`[OK] ${slug}`));
    const failForSlug = report.fail.some(
      (l) => l.includes(`[FAIL] ${slug}`) && /parse error/i.test(l),
    );
    expect(failForSlug).toBe(true);
    // Slug must NOT also be reported as OK.
    expect(okForSlug).toBe(false);
  });

  it("does not emit [OK] for a slug with a mix of valid + parse-errored Dojo files", () => {
    const slug = "mastra";
    const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    // Dojo: valid root + malformed apps/agent/package.json.
    write(
      path.join(exDir, "apps", "agent", "package.json"),
      "{ not valid json",
    );
    write(
      path.join(exDir, "package.json"),
      JSON.stringify({
        name: slug,
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );

    const report = validateAll();
    const okForSlug = report.ok.some((l) => l.includes(`[OK] ${slug}`));
    const failForSlug = report.fail.some(
      (l) => l.includes(`[FAIL] ${slug}`) && /parse error/i.test(l),
    );
    expect(failForSlug).toBe(true);
    expect(okForSlug).toBe(false);
  });
});
describe("JS vs Python dep name collisions are kept separate", () => {
  it("collectDepsFromDir tracks JS and Python deps in separate maps", () => {
    withTmp((tmp) => {
      // Create both a package.json and a requirements.txt with the same
      // dep name `openai` — JS has "4.0.0" (valid semver), Python has
      // "==1.2.3" (PEP 440 exact). If the two collapsed into a shared
      // slot, the JS spec could be erased and downstream JS comparisons
      // would see the Python spec (e.g. `==1.2.3`) instead.
      write(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "x", dependencies: { openai: "4.0.0" } }),
      );
      write(path.join(tmp, "requirements.txt"), ["openai==1.2.3"].join("\n"));
      const src = collectDojoDeps(tmp);
      // Python side tracks the Python spec.
      expect(src.pythonDeps["openai"]).toBe("==1.2.3");
      // JS side tracks the JS spec in its own map (independent of
      // whether the name also appears under pythonDeps).
      expect(src.jsDeps["openai"]).toBe("4.0.0");
    });
  });

  it("validateAll surfaces drift on BOTH the JS and Python `openai` when showcase and Dojo diverge", () => {
    // End-to-end: with same-name JS + Python deps in both sides, the
    // comparator must evaluate both ecosystems and report drift on
    // each separately. Before the fix, JS `openai` was erased (diffMaps
    // stripped it because pythonDeps also had `openai`), so the JS
    // drift went undetected.
    const repoRoot = tmpdir();
    const saved = process.env.VALIDATE_PINS_REPO_ROOT;
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    try {
      const slug = "mastra";
      const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
      const exDir = path.join(repoRoot, "examples", "integrations", slug);
      fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
        recursive: true,
      });
      // Showcase: JS openai=4.0.0, Python openai==1.2.3
      write(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: slug, dependencies: { openai: "4.0.0" } }),
      );
      write(path.join(pkgDir, "requirements.txt"), "openai==1.2.3\n");
      // Dojo: JS openai=4.1.0 (JS drift), Python openai==1.3.0 (Python drift)
      write(
        path.join(exDir, "package.json"),
        JSON.stringify({ name: slug, dependencies: { openai: "4.1.0" } }),
      );
      write(path.join(exDir, "requirements.txt"), "openai==1.3.0\n");
      const report = validateAll();
      // JS drift should be surfaced.
      const jsDrift = report.fail.some(
        (l) =>
          l.includes(slug) &&
          l.includes("openai") &&
          /4\.0\.0/.test(l) &&
          /4\.1\.0/.test(l),
      );
      // Python drift should be surfaced.
      const pyDrift = report.fail.some(
        (l) =>
          l.includes(slug) &&
          l.includes("openai") &&
          /==1\.2\.3/.test(l) &&
          /==1\.3\.0/.test(l),
      );
      expect(jsDrift).toBe(true);
      expect(pyDrift).toBe(true);
    } finally {
      if (saved === undefined) {
        delete process.env.VALIDATE_PINS_REPO_ROOT;
      } else {
        process.env.VALIDATE_PINS_REPO_ROOT = saved;
      }
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
describe("printReport within-stream order", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("stdout emits ALL OK lines before any SKIP line", async () => {
    const { printReport } = await import("../validate-pins.js");
    printReport({
      ok: ["[OK] slug-a", "[OK] slug-b"],
      skip: ["[SKIP] slug-c", "[SKIP] slug-d"],
      warn: [],
      fail: [],
    });
    const stdoutLines = stdoutSpy.mock.calls.map((c) => String(c[0]));
    // Compare LAST OK vs FIRST SKIP so we catch interleaving, not just
    // first-match ordering. `findIndex` alone would pass even if a
    // stray [OK] appeared after [SKIP].
    const firstSkipIdx = stdoutLines.findIndex((l) => l.startsWith("[SKIP]"));
    const lastOkIdx = stdoutLines.findLastIndex((l) => l.startsWith("[OK]"));
    expect(firstSkipIdx).toBeGreaterThanOrEqual(0);
    expect(lastOkIdx).toBeGreaterThanOrEqual(0);
    expect(lastOkIdx).toBeLessThan(firstSkipIdx);
  });

  it("stderr emits ALL WARN lines before any FAIL line", async () => {
    const { printReport } = await import("../validate-pins.js");
    printReport({
      ok: [],
      skip: [],
      warn: ["[WARN] slug-a", "[WARN] slug-b"],
      fail: ["[FAIL] slug-c", "[FAIL] slug-d"],
    });
    const stderrLines = stderrSpy.mock.calls.map((c) => String(c[0]));
    // Compare LAST WARN vs FIRST FAIL — see note above.
    const firstFailIdx = stderrLines.findIndex((l) => l.startsWith("[FAIL]"));
    const lastWarnIdx = stderrLines.findLastIndex((l) =>
      l.startsWith("[WARN]"),
    );
    expect(firstFailIdx).toBeGreaterThanOrEqual(0);
    expect(lastWarnIdx).toBeGreaterThanOrEqual(0);
    expect(lastWarnIdx).toBeLessThan(firstFailIdx);
  });
});
describe("collectShowcaseDeps: falsy throw from fs.statSync", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records an infra parse error and logs a stderr diagnostic when statSync throws null", () => {
    withTmp((tmp) => {
      // Arrange: package dir containing a package.json that would normally
      // be stat'd then parsed. We force fs.statSync to throw `null` for
      // exactly this path to simulate a misbehaving fs layer (primitive
      // throw, no error metadata at all).
      const pkgDir = path.join(tmp, "showcase", "packages", "mastra");
      fs.mkdirSync(pkgDir, { recursive: true });
      const pkgJsonPath = path.join(pkgDir, "package.json");
      write(pkgJsonPath, JSON.stringify({ name: "mastra", dependencies: {} }));

      const realStatSync = fs.statSync.bind(fs);
      vi.spyOn(fs, "statSync").mockImplementation((p, opts) => {
        // Only hijack the one specific lookup the test cares about — leave
        // other stat calls (tmp dir probes, etc.) unaffected so collateral
        // lookups inside collectDepsFromDir don't blow up on infrastructure.
        if (typeof p === "string" && p === pkgJsonPath) {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw null;
        }
        return realStatSync(p as fs.PathLike, opts as fs.StatSyncOptions);
      });

      const res = collectShowcaseDeps(pkgDir);

      // The fix must surface the problem. A missing-file skip (the old
      // silent behaviour) would leave parseErrors empty.
      const falsyPe = res.parseErrors.find((pe) => pe.file === pkgJsonPath);
      expect(falsyPe, JSON.stringify(res.parseErrors)).toBeDefined();
      expect(falsyPe!.infra).toBe(true);
      expect(falsyPe!.message).toMatch(/falsy/i);

      // And a diagnostic must land on stderr — we literally don't know
      // what happened, so we leave a breadcrumb for the operator.
      const stderrCalls = stderrSpy.mock.calls.flat().join("\n");
      expect(stderrCalls).toMatch(/falsy/i);
      expect(stderrCalls).toContain(pkgJsonPath);
    });
  });
});
