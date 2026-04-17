import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import {
  parsePackageJson,
  parsePyprojectToml,
  parsePyprojectTomlDetailed,
  parseRequirementsLine,
  parseRequirementsTxt,
  parseRequirementsTxtDetailed,
  canonicalizePythonName,
  isExactSpec,
  collectDojoDeps,
  collectShowcaseDeps,
  validateAll,
  isMainPath,
  isFrameworkDep,
} from "../validate-pins.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "pins");
const VALIDATE_PINS_SCRIPT = path.resolve(__dirname, "..", "validate-pins.ts");

function tmpdir(prefix = "validate-pins-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
}

/**
 * Safe-cleanup helper: call body() but always rm -rf tmp in finally so
 * an assertion failure doesn't leak temp directories into /tmp.
 */
function withTmp<T>(body: (tmp: string) => T): T {
  const tmp = tmpdir();
  try {
    return body(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("parsePackageJson", () => {
  it("merges dependencies, devDependencies, and peerDependencies", () => {
    const file = path.join(FIXTURES_DIR, "pkg-all-dep-types.json");
    const deps = parsePackageJson(file);
    expect(deps["next"]).toBe("15.0.0");
    expect(deps["@copilotkit/react-core"]).toBe("1.10.0");
    // devDependencies merged in
    expect(deps["@langchain/langgraph"]).toBe("0.2.14");
    expect(deps["typescript"]).toBe("5.0.0");
    // peerDependencies merged in
    expect(deps["@ag-ui/core"]).toBe("0.0.9");
  });

  // T3: when the SAME dep name appears in all three buckets, dev wins.
  it("dev > peer > runtime precedence when same dep appears in all three", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "package.json");
      write(
        file,
        JSON.stringify({
          name: "triple",
          dependencies: { "@mastra/core": "0.1.0" },
          peerDependencies: { "@mastra/core": "0.2.0" },
          devDependencies: { "@mastra/core": "0.3.0" },
        }),
      );
      const deps = parsePackageJson(file);
      // devDependencies spread last → dev wins.
      expect(deps["@mastra/core"]).toBe("0.3.0");
    });
  });

  // A3: parsePackageJson must reject arrays / null / scalars as top-level.
  it("throws when JSON top-level is an array (not an object)", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "package.json");
      write(file, "[1, 2, 3]");
      expect(() => parsePackageJson(file)).toThrow(/object/i);
    });
  });

  it("throws when JSON top-level is null", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "package.json");
      write(file, "null");
      expect(() => parsePackageJson(file)).toThrow(/object/i);
    });
  });

  it("throws when JSON top-level is a scalar", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "package.json");
      write(file, "42");
      expect(() => parsePackageJson(file)).toThrow(/object/i);
    });
  });
});

describe("parsePyprojectToml", () => {
  it("parses [project].dependencies even when optional-dependencies appears before", () => {
    const file = path.join(FIXTURES_DIR, "pyproject-optional-first.toml");
    const deps = parsePyprojectToml(file);
    expect(deps["langgraph"]).toBe("==0.2.14");
    expect(deps["copilotkit"]).toBe("==1.10.0");
  });

  it("parses Poetry [tool.poetry.dependencies] table format", () => {
    const file = path.join(FIXTURES_DIR, "pyproject-poetry.toml");
    const deps = parsePyprojectToml(file);
    // Poetry bare-version semantics: `"0.2.14"` means `^0.2.14`. The
    // parser preserves this by prefixing `^` so downstream `isExactSpec`
    // correctly classifies it as non-exact.
    expect(deps["langgraph"]).toBe("^0.2.14");
    expect(deps["copilotkit"]).toBe("^1.10.0");
    expect(deps["pydantic-ai"]).toBe("^0.0.20");
    // Must not include python marker
    expect(deps["python"]).toBeUndefined();
    // Q4: also verify isExactSpec classification, don't rely on
    // isExactSpec(undefined) accidentally returning false.
    expect(isExactSpec(deps["langgraph"])).toBe(false);
    expect(isExactSpec(deps["copilotkit"])).toBe(false);
    expect(isExactSpec(deps["pydantic-ai"])).toBe(false);
  });

  it("does not truncate dependencies at [project.optional-dependencies] subtable", () => {
    const file = path.join(FIXTURES_DIR, "pyproject-with-subtable.toml");
    const deps = parsePyprojectToml(file);
    expect(deps["langgraph"]).toBe("==0.2.14");
    expect(deps["copilotkit"]).toBe("==1.10.0");
  });

  // A5: PEP 621 [project.optional-dependencies] subsections must be scanned.
  it("scans [project.optional-dependencies] arrays (PEP 621 extras)", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[project]",
          'name = "x"',
          "dependencies = []",
          "",
          "[project.optional-dependencies]",
          'agent = ["langgraph==0.2.14", "copilotkit==1.10.0"]',
          'dev = ["pytest==8.0.0"]',
          "",
          "[tool.ruff]",
          "line-length = 100",
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      expect(deps["langgraph"]).toBe("==0.2.14");
      expect(deps["copilotkit"]).toBe("==1.10.0");
      expect(deps["pytest"]).toBe("==8.0.0");
    });
  });

  // A4: Poetry inline-table forms must be classified correctly.
  it("parses Poetry inline-table version = '...' form", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'foo_exact = { version = "1.2.3" }',
          'foo_caret = { version = "^1.2.3" }',
          'foo_pep440 = { version = "==1.2.3" }',
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      // Bare version inside inline table also follows Poetry semantics.
      expect(deps["foo_exact"]).toBe("^1.2.3");
      expect(isExactSpec(deps["foo_exact"])).toBe(false);
      expect(deps["foo_caret"]).toBe("^1.2.3");
      expect(isExactSpec(deps["foo_caret"])).toBe(false);
      expect(deps["foo_pep440"]).toBe("==1.2.3");
      expect(isExactSpec(deps["foo_pep440"])).toBe(true);
    });
  });

  // A4: Poetry git-only / path-only / version-less inline tables must be
  // RECORDED in `skipped` rather than silently dropped.
  it("records Poetry git-only / path-only / version-less deps in skipped[]", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'gitdep = { git = "https://example.com/x.git", rev = "main" }',
          'pathdep = { path = "../other" }',
          'weird = { extras = ["x"] }',
          'good = "==1.2.3"',
        ].join("\n"),
      );
      const { deps, skipped } = parsePyprojectTomlDetailed(file);
      expect(deps["good"]).toBe("==1.2.3");
      expect(deps["gitdep"]).toBeUndefined();
      expect(deps["pathdep"]).toBeUndefined();
      expect(deps["weird"]).toBeUndefined();

      const names = skipped.map((s) => s.name);
      expect(names).toContain("gitdep");
      expect(names).toContain("pathdep");
      expect(names).toContain("weird");
    });
  });

  // A6: unterminated `dependencies = [` must throw, not silently parse {}.
  it("throws on unterminated dependencies = [ array (malformed TOML)", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      // Open bracket, no close bracket anywhere in file.
      write(
        file,
        [
          "[project]",
          'name = "x"',
          "dependencies = [",
          '  "foo==1.0.0"',
          // missing closing `]`
        ].join("\n"),
      );
      expect(() => parsePyprojectToml(file)).toThrow(/malformed/i);
    });
  });
});

describe("parseRequirementsLine", () => {
  it("returns null on comments", () => {
    expect(parseRequirementsLine("# comment line")).toBeNull();
    expect(parseRequirementsLine("  # indented comment")).toBeNull();
  });

  it("returns null on empty lines", () => {
    expect(parseRequirementsLine("")).toBeNull();
    expect(parseRequirementsLine("   ")).toBeNull();
  });

  it("strips environment markers", () => {
    const parsed = parseRequirementsLine(
      "langgraph==0.2.14 ; python_version >= '3.10'",
    );
    expect(parsed).not.toBeNull();
    expect(parsed![0]).toBe("langgraph");
    expect(parsed![1]).toBe("==0.2.14");
  });

  it("strips extras", () => {
    const parsed = parseRequirementsLine("langchain[openai]==0.3.0");
    expect(parsed).not.toBeNull();
    expect(parsed![0]).toBe("langchain");
    expect(parsed![1]).toBe("==0.3.0");
  });

  it("strips pip hash and index-url flags", () => {
    const parsed = parseRequirementsLine(
      "foo==1.0.0 --hash=sha256:abcdef --index-url=https://example.com",
    );
    expect(parsed).not.toBeNull();
    expect(parsed![0]).toBe("foo");
    expect(parsed![1]).toBe("==1.0.0");
  });
});

// T2: Direct unit tests for parseRequirementsTxt covering real-world shapes.
describe("parseRequirementsTxt (file-level)", () => {
  it("handles multi-line files with comments, blanks, extras, and flags", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "requirements.txt");
      write(
        file,
        [
          "# Runtime deps",
          "",
          "langgraph==0.2.14",
          "langchain[openai]==0.3.0  # inline comment",
          "",
          "copilotkit==1.10.0 --hash=sha256:deadbeef",
          "# another comment",
        ].join("\n"),
      );
      const deps = parseRequirementsTxt(file);
      expect(deps["langgraph"]).toBe("==0.2.14");
      expect(deps["langchain"]).toBe("==0.3.0");
      expect(deps["copilotkit"]).toBe("==1.10.0");
    });
  });

  it("skips editable (`-e`) and URL-based installs (not dropped)", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "requirements.txt");
      write(
        file,
        [
          "-e git+https://github.com/foo/bar.git#egg=bar",
          "https://example.com/wheel.whl",
          "git+ssh://git@github.com/foo/bar.git",
          "langgraph==0.2.14",
        ].join("\n"),
      );
      const { deps, dropped } = parseRequirementsTxtDetailed(file);
      expect(deps["langgraph"]).toBe("==0.2.14");
      // URLs and -e are intentional non-deps, NOT drops.
      expect(dropped).toEqual([]);
    });
  });

  it("first-writer-wins when same dep appears twice in a file", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "requirements.txt");
      write(file, ["langgraph==0.2.14", "langgraph==0.3.0"].join("\n"));
      const deps = parseRequirementsTxt(file);
      expect(deps["langgraph"]).toBe("==0.2.14");
    });
  });

  // A7: truly unparseable lines (not editable, not URL) must be reported.
  it("records unparseable lines in dropped[]", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "requirements.txt");
      write(
        file,
        [
          "==1.0.0", // starts with operator — no name
          "langgraph==0.2.14",
        ].join("\n"),
      );
      const { deps, dropped } = parseRequirementsTxtDetailed(file);
      expect(deps["langgraph"]).toBe("==0.2.14");
      // Operator-leading line has no name; parseRequirementsLine returns null.
      expect(dropped.length).toBeGreaterThan(0);
      expect(dropped[0]).toMatch(/==1\.0\.0/);
    });
  });
});

describe("canonicalizePythonName (PEP 503)", () => {
  it("treats underscores, dashes, and dots as equivalent", () => {
    expect(canonicalizePythonName("langgraph_checkpoint")).toBe(
      canonicalizePythonName("langgraph-checkpoint"),
    );
    expect(canonicalizePythonName("langgraph.checkpoint")).toBe(
      canonicalizePythonName("langgraph-checkpoint"),
    );
  });

  it("lowercases the name", () => {
    expect(canonicalizePythonName("LangGraph")).toBe("langgraph");
  });
});

describe("isExactSpec", () => {
  it("accepts exact npm semver strings", () => {
    expect(isExactSpec("1.0.0")).toBe(true);
    expect(isExactSpec("15.0.0")).toBe(true);
    expect(isExactSpec("0.2.14")).toBe(true);
    expect(isExactSpec("0.0.1-beta.1")).toBe(true);
  });

  it("accepts exact Python == specs", () => {
    expect(isExactSpec("==1.0.0")).toBe(true);
    expect(isExactSpec("==0.2.14")).toBe(true);
  });

  // T7: Python === triple-equals (PEP 440 arbitrary equality) is exact.
  it("accepts Python === triple-equals exact specs", () => {
    expect(isExactSpec("===1.2.3")).toBe(true);
    expect(isExactSpec("===1.2.3rc1")).toBe(true);
  });

  it("rejects range operators", () => {
    expect(isExactSpec("^1.0.0")).toBe(false);
    expect(isExactSpec("~1.0.0")).toBe(false);
    expect(isExactSpec(">=1.0.0")).toBe(false);
    expect(isExactSpec(">1.0.0")).toBe(false);
  });

  it("rejects dist-tags and workspace refs", () => {
    expect(isExactSpec("latest")).toBe(false);
    expect(isExactSpec("next")).toBe(false);
    expect(isExactSpec("*")).toBe(false);
    expect(isExactSpec("workspace:*")).toBe(false);
    expect(isExactSpec("workspace:^")).toBe(false);
  });

  it("rejects empty specs", () => {
    expect(isExactSpec("")).toBe(false);
  });
});

describe("Unpinned spec rejection in validateAll", () => {
  let repoRoot: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
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
    process.chdir(origCwd);
    delete process.env.VALIDATE_PINS_REPO_ROOT;
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
    // Q1: assert against the specific slug + dep name + message fragment.
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
    // Q1: specific slug + dep + expected message fragment.
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

    const { deps } = collectDojoDeps(tmp);
    expect(deps["@langchain/langgraph"]).toBe("0.2.14");
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
    const { deps } = collectDojoDeps(tmp);
    expect(deps["langgraph"]).toBe("==0.2.14");
  });

  // T4: three-way first-writer-wins root + apps/agent + apps/web.
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
    const { deps } = collectDojoDeps(tmp);
    // apps/agent is walked first in DEP_FILE_CANDIDATES → wins.
    expect(deps["foo"]).toBe("0.0.2");
  });

  // T12: parse-error resilience — one bad sibling doesn't abort.
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
    const { deps, parseErrors } = collectDojoDeps(tmp);
    expect(parseErrors.length).toBeGreaterThan(0);
    // Sibling still parsed.
    expect(deps["@mastra/core"]).toBe("0.15.0");
  });
});

describe("validateAll cross-drift detection", () => {
  let repoRoot: string;

  beforeEach(() => {
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
    delete process.env.VALIDATE_PINS_REPO_ROOT;
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
    // Q1: specific slug + dep + "absent".
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
    // Q1: assert on the slug + message framing.
    const matching = report.fail.filter(
      (l) =>
        l.includes(`[FAIL] ${slug}:`) &&
        /langgraph[-_]checkpoint/.test(l) &&
        (/0\.1\.0/.test(l) || /0\.2\.0/.test(l)),
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  // T10: exact-pin match both sides → OK, no FAIL.
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

  // T11: zero dep files on showcase side produces WARN, no FAIL.
  it("WARNs (not FAILs) when showcase package has zero dep files", () => {
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
    const warned = report.warn.some(
      (l) =>
        l.includes(slug) && /no dependency files found in showcase/i.test(l),
    );
    expect(warned).toBe(true);
    expect(report.fail.filter((l) => l.includes(slug))).toEqual([]);
  });

  // T9: BORN_IN_SHOWCASE slug must produce a [SKIP] entry, not FAIL/WARN.
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

  // T8: isMainPath(undefined, ...) must return false, not crash.
  it("returns false for undefined argv1", () => {
    expect(isMainPath(undefined, "/any/path.ts")).toBe(false);
  });
});

describe("FALLBACK_MAP fallthrough when target missing", () => {
  let repoRoot: string;

  beforeEach(() => {
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
    delete process.env.VALIDATE_PINS_REPO_ROOT;
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
});

describe("FAIL/WARN go to stderr", () => {
  let repoRoot: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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
    delete process.env.VALIDATE_PINS_REPO_ROOT;
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

  // A12: a parse error must produce EXACTLY ONE [FAIL] line (no
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

describe("FRAMEWORK_PATTERNS coverage", () => {
  it("matches ag2, langroid, llama_index underscore form", () => {
    expect(isFrameworkDep("ag2")).toBe(true);
    expect(isFrameworkDep("langroid")).toBe(true);
    expect(isFrameworkDep("llama_index")).toBe(true);
  });

  // Sanity: Maven-coord form `org.springframework.ai:*`.
  it("matches Maven-coord org.springframework.ai:<artifact>", () => {
    expect(isFrameworkDep("org.springframework.ai:spring-ai-core")).toBe(true);
  });
});

// A2: isExactSpec must reject npm wildcard / x-range specs.
describe("isExactSpec wildcard rejection (A2)", () => {
  it("rejects `1.x`, `1.2.x`, `1.2.*`, `*`, `x.x.x`, `1.*`", () => {
    expect(isExactSpec("1.x")).toBe(false);
    expect(isExactSpec("1.2.x")).toBe(false);
    expect(isExactSpec("1.2.*")).toBe(false);
    expect(isExactSpec("*")).toBe(false);
    expect(isExactSpec("x.x.x")).toBe(false);
    expect(isExactSpec("1.X")).toBe(false);
    expect(isExactSpec("1.*")).toBe(false);
  });
});

// A6: Poetry bare versions like "1.2.3" mean ^1.2.3 in Poetry semantics and
// must NOT be treated as exact pins. Only `==x.y.z` (PEP 440 form) counts.
describe("parsePyprojectToml Poetry bare version semantics (A6)", () => {
  it("marks bare Poetry versions as non-exact (Poetry treats them as ^)", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'foo_bare = "1.2.3"',
          'foo_caret = "^1.2.3"',
          'foo_tilde = "~1.2"',
          'foo_range = ">=1.0,<2.0"',
          'foo_exact = "==1.2.3"',
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      // Bare Poetry versions must be non-exact per Poetry semantics.
      expect(isExactSpec(deps["foo_bare"])).toBe(false);
      // Range operators must always be non-exact.
      expect(isExactSpec(deps["foo_caret"])).toBe(false);
      expect(isExactSpec(deps["foo_tilde"])).toBe(false);
      expect(isExactSpec(deps["foo_range"])).toBe(false);
      // Explicit PEP 440 `==` pin remains exact.
      expect(isExactSpec(deps["foo_exact"])).toBe(true);
    });
  });
});

// A7: Poetry group dependency tables must be parsed.
describe("parsePyprojectToml Poetry group sections (A7)", () => {
  it("parses [tool.poetry.group.<name>.dependencies] tables", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'langgraph = "==0.2.14"',
          "",
          "[tool.poetry.group.dev.dependencies]",
          'pytest = "==8.0.0"',
          "",
          "[tool.poetry.group.agent.dependencies]",
          'copilotkit = "==1.10.0"',
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      expect(deps["langgraph"]).toBe("==0.2.14");
      expect(deps["pytest"]).toBe("==8.0.0");
      expect(deps["copilotkit"]).toBe("==1.10.0");
    });
  });
});

// T5: when both [project] and [tool.poetry.dependencies] are present,
// PEP 621 [project] wins (first-writer-wins in parse order).
describe("parsePyprojectToml precedence: [project] before Poetry", () => {
  it("PEP 621 [project] deps win over Poetry for the same name", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[project]",
          'name = "hybrid"',
          'dependencies = ["langgraph==0.2.14"]',
          "",
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'langgraph = "==0.3.0"',
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      // PEP 621 runs first in the parser → wins.
      expect(deps["langgraph"]).toBe("==0.2.14");
    });
  });
});

// A3, A4, A5, A1, A8 integration tests — verified end-to-end through
// validateAll rather than at unit-level, because the bugs are in how
// report states translate to exit-affecting FAILs.
describe("validateAll exit-code integration (A3, A4, A8, A1, A5)", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
  });

  afterEach(() => {
    delete process.env.VALIDATE_PINS_REPO_ROOT;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  // A3: missing PACKAGES_DIR must not result in a green exit.
  it("A3: missing packages dir produces a FAIL so exit is non-zero", () => {
    // Do NOT create showcase/packages.
    const report = validateAll();
    expect(report.fail.length).toBeGreaterThan(0);
  });

  // A3: empty PACKAGES_DIR must also not silently pass.
  it("A3: empty packages dir produces a FAIL so exit is non-zero", () => {
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    const report = validateAll();
    expect(report.fail.length).toBeGreaterThan(0);
  });

  // A4: parse errors must produce a FAIL (force non-zero exit).
  it("A4: parse errors produce a FAIL (not just a WARN)", () => {
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

  // A13: when files existed but ALL parse-errored, do not ALSO emit the
  // "no dependency files found" WARN (it's confusing double-reporting).
  it("A13: all-files-parse-error must not produce a 'no dep files' WARN", () => {
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
    const noFilesWarn = report.warn.some(
      (l) =>
        l.includes(slug) && /no dependency files found in showcase/i.test(l),
    );
    expect(noFilesWarn).toBe(false);
    // But the parse FAIL is still present.
    expect(
      report.fail.some((l) => l.includes(slug) && /parse error/i.test(l)),
    ).toBe(true);
  });

  // A5: apps/web/package.json in showcase should be scanned.
  it("A5: apps/web/package.json in a showcase package is scanned", () => {
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

  // A1: JS dep names must NOT be Python-canonicalized. Mixed separators
  // in npm names like `@mastra/foo.bar` vs `@mastra/foo-bar` are DIFFERENT
  // packages and must not be collapsed.
  it("A1: JS package.json deps are compared without Python canonicalization", () => {
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

  // A8: framework detection must canonicalize the name before the pattern
  // check so PEP 503 variants (mixed case) are still recognized.
  it("A8: framework detection recognizes mixed-case Python framework names", () => {
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

// A10: REPO_ROOT env override validation.
describe("computeRepoRoot env override validation (A10)", () => {
  afterEach(() => {
    delete process.env.VALIDATE_PINS_REPO_ROOT;
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

// T1: CLI subprocess exit-code verification.
describe("validate-pins CLI exit codes (T1)", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = tmpdir();
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function runCli() {
    return spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
      encoding: "utf-8",
      env: { ...process.env, VALIDATE_PINS_REPO_ROOT: repoRoot },
      timeout: 30_000,
    });
  }

  it("exits 1 when FAIL>0 (e.g. empty packages dir)", () => {
    const r = runCli();
    expect(r.status, r.stdout + r.stderr).toBe(1);
  });

  it("exits 0 when clean (all [OK]/[SKIP])", () => {
    // Create one born-in-showcase slug → [SKIP], FAIL=0, exit 0.
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages", "ag2"), {
      recursive: true,
    });
    const r = runCli();
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

// Q3: verify that importing validate-pins.ts does NOT invoke main() (exit 0).
describe("module import does not invoke main() (Q3)", () => {
  it("importing the module exits cleanly (status 0)", () => {
    // Use tsx's module loader via a small inline program that imports
    // validate-pins.js. If main() were invoked on import, the process
    // would exit with the validator's report status (likely 1 in this
    // test environment), NOT 0.
    const prog = `import(${JSON.stringify(
      VALIDATE_PINS_SCRIPT,
    )}).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(42); });`;

    const r = spawnSync("npx", ["tsx", "-e", prog], {
      encoding: "utf-8",
      env: {
        ...process.env,
        // Point REPO_ROOT at this worktree so computeRepoRoot's override
        // validation passes; the value is irrelevant because main() must
        // not run.
        VALIDATE_PINS_REPO_ROOT: path.resolve(__dirname, "..", "..", ".."),
      },
      timeout: 30_000,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
