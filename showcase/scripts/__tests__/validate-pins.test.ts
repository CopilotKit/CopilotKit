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

  // when the SAME dep name appears in all three buckets, dev wins.
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

  // parsePackageJson must reject arrays / null / scalars as top-level.
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

  // dep bucket entries must be strings. A malformed
  // package.json with an object value (e.g. a spec-object pattern some
  // tooling emits) would otherwise flow into the DepMap as an object
  // and crash downstream comparisons with a non-obvious error.
  it("throws when a dependency value is not a string", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "package.json");
      write(
        file,
        JSON.stringify({
          name: "x",
          dependencies: { langgraph: { version: "0.2.14" } },
        }),
      );
      expect(() => parsePackageJson(file)).toThrow(/string/i);
    });
  });

  it("throws when devDependencies value is a number", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "package.json");
      write(
        file,
        JSON.stringify({
          name: "x",
          devDependencies: { typescript: 5 },
        }),
      );
      expect(() => parsePackageJson(file)).toThrow(/string/i);
    });
  });

  it("throws when dependencies is a non-object", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "package.json");
      write(
        file,
        JSON.stringify({
          name: "x",
          dependencies: "this should be an object",
        }),
      );
      expect(() => parsePackageJson(file)).toThrow(
        /dependencies.*object|expected.*object/i,
      );
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
    // also verify isExactSpec classification, don't rely on
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

  // PEP 621 [project.optional-dependencies] subsections must be scanned.
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

  // Poetry inline-table forms must be classified correctly.
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

  // Poetry inline-table `version = '...'` single-quoted form must
  // also parse. Previously the regex only handled double-quoted.
  it("parses Poetry inline-table version = '...' with single quotes", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          "python = '^3.10'",
          "foo_exact = { version = '1.2.3' }",
          "foo_caret = { version = '^1.2.3' }",
          "foo_pep440 = { version = '==1.2.3' }",
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      expect(deps["foo_exact"]).toBe("^1.2.3");
      expect(deps["foo_caret"]).toBe("^1.2.3");
      expect(deps["foo_pep440"]).toBe("==1.2.3");
    });
  });

  // the `python = "^3.10"` interpreter constraint appears
  // in every real-world Poetry pyproject.toml and must be silently
  // ignored (it is not a runtime dependency).
  it("skips the Poetry `python` interpreter constraint", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'langgraph = "==0.2.14"',
        ].join("\n"),
      );
      const { deps, skipped } = parsePyprojectTomlDetailed(file);
      expect(deps["langgraph"]).toBe("==0.2.14");
      // `python` must be absent from deps entirely — not "skipped with
      // a reason", but silently omitted, because the interpreter
      // constraint is not a framework dep.
      expect(deps["python"]).toBeUndefined();
      expect(skipped.find((s) => s.name === "python")).toBeUndefined();
    });
  });

  // Poetry flavor: `foo = ""` empty version is malformed;
  // surface in `skipped` so operators know the manifest is broken
  // rather than silently admitting the dep with an empty spec.
  it("Poetry empty version string surfaces in skipped[]", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'foo_empty = ""',
          'foo_good = "==1.2.3"',
        ].join("\n"),
      );
      const { deps, skipped } = parsePyprojectTomlDetailed(file);
      expect(deps["foo_good"]).toBe("==1.2.3");
      expect(deps["foo_empty"]).toBeUndefined();
      expect(skipped.map((s) => s.name)).toContain("foo_empty");
    });
  });

  // Poetry git-only / path-only / version-less inline tables must be
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

  // unterminated `dependencies = [` must throw, not silently parse {}.
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

  // name-only requirement (no version spec) — returns the
  // name with an empty spec string. Used to be silently untested; now
  // asserted so the `[name, ""]` shape is part of the contract.
  it("returns [name, ''] for a name-only line (no version)", () => {
    const parsed = parseRequirementsLine("langgraph");
    expect(parsed).not.toBeNull();
    expect(parsed![0]).toBe("langgraph");
    expect(parsed![1]).toBe("");
  });

  it("returns [name, ''] for a name-only line with trailing whitespace", () => {
    const parsed = parseRequirementsLine("langgraph   ");
    expect(parsed).not.toBeNull();
    expect(parsed![0]).toBe("langgraph");
    expect(parsed![1]).toBe("");
  });
});

// Direct unit tests for parseRequirementsTxt covering real-world shapes.
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

  // name-only lines ARE parseable by parseRequirementsLine (it
  // returns [name, ""]) but they are NOT pinning anything. The file-
  // level walker must surface them as `skipped` so the WARN line tells
  // operators that the manifest has an unpinned dep, rather than the
  // dep being silently admitted to the DepMap with an empty spec.
  it("name-only requirement surfaces in skipped[] (not deps)", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "requirements.txt");
      write(file, ["langgraph", "copilotkit==1.10.0"].join("\n"));
      const { deps, skipped } = parseRequirementsTxtDetailed(file);
      // Correctly-pinned dep still makes it in.
      expect(deps["copilotkit"]).toBe("==1.10.0");
      // Name-only was NOT admitted to deps.
      expect(deps["langgraph"]).toBeUndefined();
      // But it IS surfaced as skipped with the name.
      const names = skipped.map((s) => s.name);
      expect(names).toContain("langgraph");
    });
  });

  // truly unparseable lines (not editable, not URL) must be reported.
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

  // Python === triple-equals (PEP 440 arbitrary equality) is exact.
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
  // Save-and-restore pattern for VALIDATE_PINS_REPO_ROOT so that if the
  // env var was set at suite entry (e.g. by an outer invocation), it's
  // preserved rather than silently deleted. `origCwd` is tracked on the
  // describe level but no test ever calls process.chdir(), so we don't
  // restore it here either.
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
    const { deps } = collectDojoDeps(tmp);
    // apps/agent is walked first in DEP_FILE_CANDIDATES → wins.
    expect(deps["foo"]).toBe("0.0.2");
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
    const { deps, parseErrors } = collectDojoDeps(tmp);
    expect(parseErrors.length).toBeGreaterThan(0);
    // Sibling still parsed.
    expect(deps["@mastra/core"]).toBe("0.15.0");
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
    const resolveSpy = vi
      .spyOn(path, "resolve")
      .mockImplementationOnce(() => {
        throw new Error("synthetic path.resolve failure");
      });
    try {
      const result = isMainPath("/any/path.ts", "/any/path.ts");
      expect(result).toBe(false);
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

// isExactSpec must reject npm wildcard / x-range specs.
describe("isExactSpec wildcard rejection", () => {
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

// Poetry bare versions like "1.2.3" mean ^1.2.3 in Poetry semantics and
// must NOT be treated as exact pins. Only `==x.y.z` (PEP 440 form) counts.
describe("parsePyprojectToml Poetry bare version semantics", () => {
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

// Poetry group dependency tables must be parsed.
describe("parsePyprojectToml Poetry group sections", () => {
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

// A [project] body must be terminated by any subsequent top-level
// header, including dotted tables like [tool.poetry]. Otherwise PEP 621
// parsing consumes the following Poetry section and can yield wrong or
// duplicated entries.
describe("parsePyprojectToml [project] terminates at dotted top-level headers", () => {
  it("does not bleed content after [tool.poetry] into [project] dependencies array", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      // [project] has NO dependencies key. A later Poetry group subtable
      // contains `dependencies = [ "poetry-only-dep==9.9.9" ]`.
      // Poetry-style parsing (parsePoetryInlineTables / groups) reads
      // each KEY under `[tool.poetry.group.dev.dependencies]` as a
      // named dep — NOT a `dependencies` array. So under the buggy
      // [project] regex, the PEP 621 scanner extends its body past
      // [tool.poetry] and finds this `dependencies = [` array, then
      // parses `poetry-only-dep==9.9.9` as a PEP 621 dep (producing
      // `==9.9.9`). The dotted-header fix terminates [project] body
      // correctly so this line is owned only by the Poetry scanner.
      write(
        file,
        [
          "[project]",
          'name = "bleed-test"',
          'version = "0.1.0"',
          "",
          "[tool.poetry.group.dev.dependencies]",
          'dependencies = ["poetry-only-dep==9.9.9"]',
        ].join("\n"),
      );
      const detailed = parsePyprojectTomlDetailed(file);
      // Under the bug, `poetry-only-dep` appears in deps as `==9.9.9`.
      // With the fix, the Poetry group scanner sees a single key named
      // `dependencies` with a non-string array value → it surfaces in
      // skipped[] as a non-string value, not in deps.
      expect(detailed.deps["poetry-only-dep"]).toBeUndefined();
    });
  });
});

// when both [project] and [tool.poetry.dependencies] are present,
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

// Integration tests — verified end-to-end through validateAll rather
// than at unit-level, because the bugs we're guarding against live in
// how report states translate to exit-affecting FAILs.
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

  // missing PACKAGES_DIR must not result in a green exit.
  it("missing packages dir produces a FAIL so exit is non-zero", () => {
    // Do NOT create showcase/packages.
    const report = validateAll();
    expect(report.fail.length).toBeGreaterThan(0);
  });

  // empty PACKAGES_DIR must also not silently pass.
  it("empty packages dir produces a FAIL so exit is non-zero", () => {
    fs.mkdirSync(path.join(repoRoot, "showcase", "packages"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    const report = validateAll();
    expect(report.fail.length).toBeGreaterThan(0);
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

// REPO_ROOT env override validation.
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

// CLI subprocess exit-code verification.
describe("validate-pins CLI exit codes", () => {
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

// Exit code 3 (EXIT_UNREADABLE) distinguishes "input was present but the
// process couldn't read it" from "internal crash" (exit 2). CI callers
// can then route a permissions misconfig to a different alert path.
describe("validate-pins CLI exit code 3 (unreadable input)", () => {
  it("exits 3 when VALIDATE_PINS_REPO_ROOT points at a non-directory", () => {
    const tmp = tmpdir();
    try {
      const filePath = path.join(tmp, "not-a-dir");
      fs.writeFileSync(filePath, "x");
      const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
        encoding: "utf-8",
        env: { ...process.env, VALIDATE_PINS_REPO_ROOT: filePath },
        timeout: 30_000,
      });
      expect(r.status, r.stdout + r.stderr).toBe(3);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// verify that importing validate-pins.ts does NOT invoke main() (exit 0).
describe("module import does not invoke main()", () => {
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

// ---------------------------------------------------------------------------
// Regression tests: pyproject / requirements parser edge cases.
// ---------------------------------------------------------------------------

// Extras-syntax in PEP 621 `[project].dependencies` MUST NOT truncate
// the array body at the embedded `]`. The scanner must be quote-aware
// so entries following `"langchain[all]==1.2.3"` are not dropped.
describe("[project].dependencies extras-syntax handling", () => {
  it("does NOT truncate at `]` embedded in `langchain[all]==1.2.3`", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[project]",
          'name = "extras-test"',
          "dependencies = [",
          '  "langchain[all]==1.2.3",',
          '  "copilotkit==1.10.0",',
          '  "langgraph==0.2.14"',
          "]",
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      // langchain (extras stripped by parseRequirementsLine) must be present.
      expect(deps["langchain"]).toBe("==1.2.3");
      // Deps following the extras MUST NOT have been dropped.
      expect(deps["copilotkit"]).toBe("==1.10.0");
      expect(deps["langgraph"]).toBe("==0.2.14");
    });
  });

  it("handles multiple extras entries in a row", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[project]",
          'name = "extras-many"',
          'dependencies = ["foo[x]==1.0", "bar[y,z]==2.0", "baz==3.0"]',
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      expect(deps["foo"]).toBe("==1.0");
      expect(deps["bar"]).toBe("==2.0");
      expect(deps["baz"]).toBe("==3.0");
    });
  });
});

// Same extras-syntax handling but under [project.optional-dependencies]
// subkey arrays — each entry must not swallow subsequent entries.
describe("[project.optional-dependencies] extras-syntax handling", () => {
  it("extras-syntax does not truncate optional-dependencies subkey arrays", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[project]",
          'name = "opt-extras"',
          "dependencies = []",
          "",
          "[project.optional-dependencies]",
          'agent = ["langchain[all]==1.2.3", "copilotkit==1.10.0", "langgraph==0.2.14"]',
          'dev = ["pytest[toml]==8.0.0", "ruff==0.3.0"]',
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      expect(deps["langchain"]).toBe("==1.2.3");
      expect(deps["copilotkit"]).toBe("==1.10.0");
      expect(deps["langgraph"]).toBe("==0.2.14");
      expect(deps["pytest"]).toBe("==8.0.0");
      expect(deps["ruff"]).toBe("==0.3.0");
    });
  });
});

// balanced-bracket scan must still throw on a truly
// unterminated top-level `[project].dependencies = [`.
describe("balanced-bracket unterminated-array enforcement", () => {
  it("throws on `dependencies = [` with no closing `]` (even when another `]` appears later in the file)", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      // A dangling `]` appears under a later unrelated section; this
      // previously satisfied the `body.includes("]")` no-op check and
      // let the parser silently produce an empty deps array.
      write(
        file,
        [
          "[project]",
          'name = "still-broken"',
          "dependencies = [",
          '  "foo==1.0.0"',
          // missing closing `]`
          "",
          "[project.optional-dependencies]",
          "# note the ] in this comment should NOT satisfy the check",
          'agent = ["copilotkit==1.10.0"]',
        ].join("\n"),
      );
      expect(() => parsePyprojectToml(file)).toThrow(/malformed/i);
    });
  });
});

// Source-grep lint (belt-and-suspenders): main() and the top-level
// catch must set `process.exitCode` instead of calling `process.exit(N)`
// so stdout has time to drain. The behavioral exit-code tests above
// cover this end-to-end; this source-scan is a cheap guard against a
// future edit re-introducing a `process.exit(N)` call site.
describe("source-grep lint: CLI uses process.exitCode (not process.exit)", () => {
  it("validate-pins.ts contains no `process.exit(N)` call sites", () => {
    const src = fs.readFileSync(VALIDATE_PINS_SCRIPT, "utf-8");
    // Strip comments and string literals to avoid false positives from
    // JSDoc mentions of `process.exit`. Simpler: match
    // `process\.exit\(` specifically and ensure count is 0.
    // Exclude occurrences inside single-line comments `// ...`.
    const noCommentSrc = src
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    const matches = noCommentSrc.match(/process\.exit\s*\(/g) ?? [];
    expect(matches.length).toBe(0);
  });
});

// `==` body must require at least MAJOR.MINOR.
describe("isExactSpec rejects degenerate Python `==` bodies", () => {
  it("rejects `==0`, `===1` without a full MAJOR.MINOR", () => {
    expect(isExactSpec("==0")).toBe(false);
    expect(isExactSpec("===1")).toBe(false);
    expect(isExactSpec("==9")).toBe(false);
  });

  it("still accepts `==0.0`, `==1.2`, `==1.2.3`", () => {
    expect(isExactSpec("==0.0")).toBe(true);
    expect(isExactSpec("==1.2")).toBe(true);
    expect(isExactSpec("==1.2.3")).toBe(true);
  });
});

// pip flag stripping must be order-independent. A single
// alternation regex avoids the subtle ordering trap of sequential
// replaces.
describe("pip flag stripping is order-independent", () => {
  it("strips --extra-index-url even when it precedes --index-url", () => {
    const parsed = parseRequirementsLine(
      "foo==1.0.0 --extra-index-url=https://a.example --index-url=https://b.example",
    );
    expect(parsed).not.toBeNull();
    expect(parsed![0]).toBe("foo");
    expect(parsed![1]).toBe("==1.0.0");
  });
});

// Poetry array-form dep (multi-constraint OR) must be recorded
// in `skipped` — silently dropping it would let pin drift slip through.
describe("Poetry array-form dep surfaces in skipped[]", () => {
  it('records `foo = ["^1.0", "^2.0"]` as skipped with a reason', () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'foo = ["^1.0", "^2.0"]',
          'good = "==1.2.3"',
        ].join("\n"),
      );
      const { deps, skipped } = parsePyprojectTomlDetailed(file);
      expect(deps["good"]).toBe("==1.2.3");
      expect(deps["foo"]).toBeUndefined();
      const fooSkip = skipped.find((s) => s.name === "foo");
      expect(fooSkip).toBeDefined();
      expect(fooSkip!.reason).toMatch(/array-form/i);
    });
  });
});

// Poetry caret-prefix must not be applied to comma-joined
// constraints. `"1.2.3,>=1.0"` starts with a digit but is already a
// multi-constraint range; prefixing produces `^1.2.3,>=1.0` which is
// nonsense.
describe("Poetry caret-prefix does not fire on comma-joined ranges", () => {
  it('leaves `"1.2.3,>=1.0"` verbatim (no leading `^`)', () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'foo = "1.2.3,>=1.0"',
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      expect(deps["foo"]).toBe("1.2.3,>=1.0");
      expect(isExactSpec(deps["foo"])).toBe(false);
    });
  });
});

// Dojo workspace ref + showcase missing the dep must WARN (not
// SKIP) so CI surfaces that the showcase package is missing a
// framework the Dojo expects to be present.
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

// SKIP message enrichment — when showcase uses workspace:* and
// Dojo pins a concrete version, the [SKIP] line should echo the Dojo
// pin so operators reading the log know what the showcase "should"
// eventually resolve to.
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

// JS PEP 503 canonicalization drift test. Names must match
// FRAMEWORK_PATTERNS so the code path that would incorrectly collapse
// `.` and `-` is actually exercised.
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

// Direct isFrameworkDep() assertions for headline framework
// names. Previously only ag2/langroid/llama_index were covered, which
// left the primary @copilotkit / @mastra / langgraph / @ag-ui patterns
// unasserted at the unit level.
describe("isFrameworkDep direct assertions for headline frameworks", () => {
  it("matches @copilotkit/*", () => {
    expect(isFrameworkDep("@copilotkit/react-core")).toBe(true);
    expect(isFrameworkDep("@copilotkit/runtime")).toBe(true);
  });
  it("matches @mastra/*", () => {
    expect(isFrameworkDep("@mastra/core")).toBe(true);
  });
  it("matches langgraph", () => {
    expect(isFrameworkDep("langgraph")).toBe(true);
  });
  it("matches langchain", () => {
    expect(isFrameworkDep("langchain")).toBe(true);
  });
  it("matches @ag-ui/*", () => {
    expect(isFrameworkDep("@ag-ui/core")).toBe(true);
  });
});

// The pre-report stderr assertion must include a
// call to `printReport(report)` AND assert [parse-error] appears
// exactly zero times (the only stderr traffic should be from
// printReport emitting [FAIL]/[WARN] lines — never a pre-report
// collector leak).
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

// A showcase package whose showcase- or dojo-side parse fails
// MUST NOT ALSO be reported as OK. Previously a parseError produced a
// FAIL line but `pkgHadViolation` was only set from the per-dep loop, so
// the same slug appeared in BOTH `report.ok` and `report.fail`.
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

// Cross-ecosystem dep name collision. A JS dep and a Python dep
// with the SAME name must not share a slot in `deps`, which would cause
// one side's spec to be obliterated by the other and then be subject to
// the wrong canonicalization. Track JS and Python deps in separate maps
// from parse time so the collision cannot occur.
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

// isExactSpec must reject exotic bare-version forms like `1x`
// and `1e2` that slip past the wildcard check (no `.`/`-`/`_` between
// the digits) but are not real semver.
describe("isExactSpec rejects exotic bare forms", () => {
  it("rejects `1x`, `2X`, `1e2`", () => {
    expect(isExactSpec("1x")).toBe(false);
    expect(isExactSpec("2X")).toBe(false);
    expect(isExactSpec("1e2")).toBe(false);
  });

  it("still accepts strict semver forms and pre-release labels", () => {
    expect(isExactSpec("1.2.3")).toBe(true);
    expect(isExactSpec("1.2.3-beta.1")).toBe(true);
    expect(isExactSpec("0.2.14")).toBe(true);
    expect(isExactSpec("1.2")).toBe(true);
    expect(isExactSpec("1")).toBe(true);
  });
});

// Non-string Poetry inline value (boolean / number / null etc.)
// MUST be recorded in `skipped[]`, not silently dropped via bare
// `continue`. Before the fix, a `foo = true` line disappeared without a
// trace.
describe("Poetry non-string dep value surfaces in skipped[]", () => {
  it("records `foo = true` as skipped with a reason naming the type", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          "foo_bool = true",
          "foo_num = 42",
          'good = "==1.2.3"',
        ].join("\n"),
      );
      const { deps, skipped } = parsePyprojectTomlDetailed(file);
      expect(deps["good"]).toBe("==1.2.3");
      expect(deps["foo_bool"]).toBeUndefined();
      expect(deps["foo_num"]).toBeUndefined();
      const names = skipped.map((s) => s.name);
      expect(names).toContain("foo_bool");
      expect(names).toContain("foo_num");
      const boolSkip = skipped.find((s) => s.name === "foo_bool");
      expect(boolSkip!.reason).toMatch(/non-string/i);
    });
  });
});

// A Poetry string value with an opening quote but no closing
// quote is UNTERMINATED. Previously the parser treated it the same as
// `foo = ""` and reported "empty version string" — the wrong diagnosis
// for operators.
describe("Poetry unterminated string value is distinguished from empty", () => {
  it('reports `foo = "1.2.3` as unterminated, not empty', () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'foo_unterm = "1.2.3',
          'good = "==1.2.3"',
        ].join("\n"),
      );
      const { deps, skipped } = parsePyprojectTomlDetailed(file);
      expect(deps["good"]).toBe("==1.2.3");
      expect(deps["foo_unterm"]).toBeUndefined();
      const untermSkip = skipped.find((s) => s.name === "foo_unterm");
      expect(untermSkip).toBeDefined();
      expect(untermSkip!.reason).toMatch(/unterminated/i);
      // And NOT the "empty version string" reason.
      expect(untermSkip!.reason).not.toMatch(/empty/i);
    });
  });
});

// Unterminated `[project.optional-dependencies]` subkey arrays
// (i.e. `agent = [` with no closing `]`) must surface as a parseError
// (FAIL), not merely a dropped-line WARN. The data is actually
// incomplete, not just noisy.
describe("unterminated optional-dependencies subkey array is a parseError", () => {
  it("throws on unterminated optional-dependencies subkey array", () => {
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
          "agent = [",
          '  "foo==1.0.0"',
          // missing closing `]` before the next section
          "",
          "[tool.poetry]",
          'name = "x"',
        ].join("\n"),
      );
      expect(() => parsePyprojectToml(file)).toThrow(/unterminated|malformed/i);
    });
  });
});

// ingestArrayBody must propagate name-only entries
// into `skipped[]` so pyproject dependencies mirror requirements.txt
// handling of `foo` with no version.
describe("pyproject name-only dep surfaces in skipped[]", () => {
  it('records `["foo"]` as skipped, not admitted to deps with empty spec', () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[project]",
          'name = "x"',
          // `foo` with no version spec, plus a correctly pinned `bar`
          'dependencies = ["foo", "bar==1.2.3"]',
        ].join("\n"),
      );
      const { deps, skipped } = parsePyprojectTomlDetailed(file);
      expect(deps["bar"]).toBe("==1.2.3");
      // `foo` must not be silently admitted to `deps` with empty spec.
      expect(deps["foo"]).toBeUndefined();
      const names = skipped.map((s) => s.name);
      expect(names).toContain("foo");
    });
  });
});

// Within-stream ordering of printReport. On stdout: OK lines
// precede SKIP lines. On stderr: WARN lines precede FAIL lines. This
// captures the current contract so reordering is a deliberate change
// and not an accidental regression.
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
    const lastWarnIdx = stderrLines.findLastIndex((l) => l.startsWith("[WARN]"));
    expect(firstFailIdx).toBeGreaterThanOrEqual(0);
    expect(lastWarnIdx).toBeGreaterThanOrEqual(0);
    expect(lastWarnIdx).toBeLessThan(firstFailIdx);
  });
});

// ---------------------------------------------------------------------------
// FX16-A: wrapper parsers throw on skipped/dropped instead of silent loss.
// ---------------------------------------------------------------------------

describe("parseRequirementsTxt wrapper throws on skipped/dropped", () => {
  it("throws when the file contains a skipped (name-only) entry", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "requirements.txt");
      // name-only line becomes `skipped` in the detailed form.
      write(file, ["langgraph", "copilotkit==1.10.0"].join("\n"));
      expect(() => parseRequirementsTxt(file)).toThrow(
        /parseRequirementsTxt.*skipped/i,
      );
    });
  });

  it("throws when the file contains a dropped (unparseable) line", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "requirements.txt");
      // An operator-leading line (spec with no package name) is
      // GUARANTEED to be dropped: parseRequirementsLine requires a
      // leading [A-Za-z0-9] identifier, so `==1.0.0` fails the regex
      // and is pushed to `dropped[]`. This input is load-bearing — it
      // deterministically exercises the dropped-path rather than
      // relying on a malformed line the parser might tolerate.
      write(file, ["==1.0.0", "langgraph==0.2.14"].join("\n"));
      // Sanity: the fixture must actually produce a drop. If this
      // invariant ever breaks (parser behavior change), the test must
      // fail LOUDLY, not silently pass via an early return.
      const detailed = parseRequirementsTxtDetailed(file);
      expect(detailed.dropped.length).toBeGreaterThan(0);
      expect(() => parseRequirementsTxt(file)).toThrow(
        /parseRequirementsTxt/i,
      );
    });
  });

  it("returns DepMap cleanly when no skipped/dropped entries", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "requirements.txt");
      write(file, ["langgraph==0.2.14", "copilotkit==1.10.0"].join("\n"));
      const deps = parseRequirementsTxt(file);
      expect(deps["langgraph"]).toBe("==0.2.14");
      expect(deps["copilotkit"]).toBe("==1.10.0");
    });
  });
});

describe("parsePyprojectToml wrapper throws on skipped/dropped", () => {
  it("throws when the file contains a skipped entry (Poetry git-only)", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      // Poetry git-only inline tables hit the `\bgit\s*=` branch in
      // ingestPoetryBody and are pushed to `skipped[]` with reason
      // "Poetry git-only dep (no version)". This input is load-bearing:
      // it deterministically produces a skipped entry so the wrapper's
      // throw contract is actually exercised.
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'langgraph = { git = "https://github.com/langchain-ai/langgraph.git" }',
          'copilotkit = "1.10.0"',
        ].join("\n"),
      );
      // Sanity: the fixture must produce a skip. If this invariant
      // breaks (parser behavior change), the test must fail LOUDLY
      // rather than silently pass via an early return.
      const detailed = parsePyprojectTomlDetailed(file);
      expect(detailed.skipped.length).toBeGreaterThan(0);
      expect(() => parsePyprojectToml(file)).toThrow(/parsePyprojectToml/i);
    });
  });

  it("returns DepMap cleanly when no skipped/dropped entries", () => {
    withTmp((tmp) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[project]",
          'name = "demo"',
          "dependencies = [",
          '  "langgraph==0.2.14",',
          '  "copilotkit==1.10.0",',
          "]",
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      expect(deps["langgraph"]).toBe("==0.2.14");
      expect(deps["copilotkit"]).toBe("==1.10.0");
    });
  });
});

// ---------------------------------------------------------------------------
// FX16-A: EACCES on example dir → EXIT_UNREADABLE (3), not EXIT_INTERNAL (2).
// Runs the validate-pins CLI end-to-end against a tmp REPO_ROOT where
// the examples/integrations/<slug>/ directory is unreadable (mode 0000).
// Skipped on CI platforms where the process runs as root (chmod has no
// effect) — detected by attempting to read a 0000 dir we create.
// ---------------------------------------------------------------------------

// Root cannot be restricted by chmod — EACCES routing can't be
// exercised when the process is uid 0. We skip at declaration time so
// the skip is VISIBLE in the test report rather than a silent early
// `return` (which makes the guard look like it always passes).
const isRoot = process.getuid?.() === 0;

// Some filesystems (e.g. certain CI mounts, network shares) ignore
// chmod 0000 and keep a dir readable even to non-root processes. We
// must NOT silently `return` from inside `it()` on those platforms —
// the test would then "pass" without exercising the EACCES routing
// under test (anti-pattern called out on lines immediately above this
// comment). Probe once at module scope and hand the result to
// `it.skipIf` so the skip is visible in the test report.
//
// The probe: create a tmp dir, chmod it 0000, then attempt to read it.
// If the read succeeds (or fails with something other than EACCES),
// chmod is not enforced here. We do the probe even when `isRoot` is
// true (the two conditions are OR'd into `cannotEnforceEacces`).
function probeChmodEnforced(): boolean {
  if (isRoot) return false;
  let probeDir: string | undefined;
  try {
    probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-chmod-probe-"));
    fs.chmodSync(probeDir, 0o000);
    try {
      // statSync on the dir itself may still work (metadata is in the
      // parent). The enforcement check is whether readdir is blocked.
      fs.readdirSync(probeDir);
      return false; // readdir succeeded → chmod not enforced
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return err.code === "EACCES";
    }
  } catch {
    return false;
  } finally {
    if (probeDir) {
      try {
        fs.chmodSync(probeDir, 0o755);
      } catch (err) {
        // Visible stderr log on leak — operators must see tmpdirs that
        // may linger at mode 0000 (rmSync would fail silently and the
        // dir stays forever).
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[validate-pins test] failed to restore perms on probe dir ${probeDir} (possible leak): ${msg}`,
        );
      }
      try {
        fs.rmSync(probeDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
}

const chmodEnforced = probeChmodEnforced();
const cannotEnforceEacces = isRoot || !chmodEnforced;

describe("EACCES on examples/integrations/<slug> routes to EXIT_UNREADABLE", () => {
  it.skipIf(cannotEnforceEacces)(
    "exits with EXIT_UNREADABLE (3) when candidate example dir is unreadable",
    () => {
      withTmp((tmp) => {
        // Build a minimal repo layout:
        //   <tmp>/examples/integrations/<slug>/     (mode 0000)
        //   <tmp>/showcase/packages/<slug>/package.json
        const slug = "mastra";
        const examplesDir = path.join(tmp, "examples", "integrations");
        const packagesDir = path.join(tmp, "showcase", "packages");
        const exampleSlugDir = path.join(examplesDir, slug);
        const pkgSlugDir = path.join(packagesDir, slug);
        fs.mkdirSync(exampleSlugDir, { recursive: true });
        fs.mkdirSync(pkgSlugDir, { recursive: true });
        write(
          path.join(pkgSlugDir, "package.json"),
          JSON.stringify({ name: slug, dependencies: {} }),
        );

        // Make example slug dir unreadable. The module-scope probe
        // (`cannotEnforceEacces`) already confirmed the FS enforces
        // chmod 0000 for this process, so we don't need a second
        // in-body probe + silent-return dance here.
        fs.chmodSync(exampleSlugDir, 0o000);

        try {
          const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
            env: {
              ...process.env,
              VALIDATE_PINS_REPO_ROOT: tmp,
            },
            encoding: "utf-8",
            timeout: 30_000,
          });
          // EXIT_UNREADABLE = 3. Must NOT be 2 (EXIT_INTERNAL) or 1
          // (EXIT_DRIFT). A successful routing yields 3.
          expect(r.status, r.stdout + r.stderr).toBe(3);
        } finally {
          // Restore perms so the rmSync in withTmp works on Linux.
          // Log to stderr if restore fails — otherwise the tmp dir
          // leaks at mode 0000 and operators never see it.
          try {
            fs.chmodSync(exampleSlugDir, 0o755);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[validate-pins test] failed to restore perms on ${exampleSlugDir} (possible leak): ${msg}`,
            );
          }
        }
      });
    },
  );
});

// ---------------------------------------------------------------------------
// FX16-A: infra errors in collectDepsFromDir (stat EACCES on a dep file)
// should route through UnreadableInputError → EXIT_UNREADABLE (3), not
// land in report.fail as EXIT_DRIFT (1).
// ---------------------------------------------------------------------------

describe("validateAll: infra parse error routes to EXIT_UNREADABLE", () => {
  it.skipIf(cannotEnforceEacces)(
    "EACCES on showcase package dir exits 3, not 1",
    () => {
      withTmp((tmp) => {
        const slug = "mastra";
        // Build a minimal repo layout where the example dir is fine but
        // the SHOWCASE PACKAGE DIR is unreadable. We chmod the parent
        // dir (not the file) because on Linux/macOS, statSync on your
        // own mode-0000 file succeeds (metadata is still accessible via
        // the parent dir). Chmodding the parent forces statSync(abs) in
        // collectDepsFromDir to throw EACCES, which hits the `infra:
        // true` branch → UnreadableInputError → EXIT_UNREADABLE (3).
        // The prior version of this test chmod'd the file, which routed
        // through readFileSync EACCES → parseErrors (not infra) →
        // EXIT_DRIFT (1), and then the assertion accepted [1, 3] which
        // defeated the fix it was meant to guard.
        const examplesDir = path.join(tmp, "examples", "integrations");
        const packagesDir = path.join(tmp, "showcase", "packages");
        const exampleSlugDir = path.join(examplesDir, slug);
        const pkgSlugDir = path.join(packagesDir, slug);
        fs.mkdirSync(exampleSlugDir, { recursive: true });
        fs.mkdirSync(pkgSlugDir, { recursive: true });
        write(
          path.join(exampleSlugDir, "package.json"),
          JSON.stringify({ name: slug, dependencies: {} }),
        );
        write(
          path.join(pkgSlugDir, "package.json"),
          JSON.stringify({ name: slug, dependencies: {} }),
        );
        // Make the package dir itself unreadable so statSync on its
        // entries fails. Module-scope probe (`cannotEnforceEacces`)
        // already confirmed the FS enforces chmod 0000 here.
        fs.chmodSync(pkgSlugDir, 0o000);

        try {
          const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
            env: {
              ...process.env,
              VALIDATE_PINS_REPO_ROOT: tmp,
            },
            encoding: "utf-8",
            timeout: 30_000,
          });
          // STRICT: the fix is that EACCES on a showcase dep-file path
          // routes to EXIT_UNREADABLE (3), not EXIT_DRIFT (1) or
          // EXIT_INTERNAL (2). Accepting [1, 3] defeats the fix.
          expect(r.status, r.stdout + r.stderr).toBe(3);
        } finally {
          try {
            fs.chmodSync(pkgSlugDir, 0o755);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[validate-pins test] failed to restore perms on ${pkgSlugDir} (possible leak): ${msg}`,
            );
          }
        }
      });
    },
  );
});

// ---------------------------------------------------------------------------
// R19-2 #1: TOCTOU on readdirSync(PACKAGES_DIR). The stat+isDirectory
// guard can succeed and THEN readdir fail (EACCES/EIO/ENOTDIR) between
// the two calls, or because the dir is traverseable but not readable.
// That failure must route to EXIT_UNREADABLE (3), not EXIT_INTERNAL (2).
// Simulated here by chmodding PACKAGES_DIR to 0o111 (--x--x--x):
// stat+isDirectory succeed but readdir throws EACCES.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// R19-2 #5: readFileSync inside parsePackageJson (and siblings) is
// unguarded. An EACCES on content-only read (readable parent, mode-0000
// file) slips past the stat guard in collectDepsFromDir and lands in
// parseErrors WITHOUT `infra: true`, which routes to report.fail →
// EXIT_DRIFT (1). The fix classifies errno codes at the catch site so
// EACCES on read routes to UnreadableInputError → EXIT_UNREADABLE (3).
// ---------------------------------------------------------------------------

describe("validateAll: readFileSync EACCES routes to EXIT_UNREADABLE", () => {
  it.skipIf(cannotEnforceEacces)(
    "exits 3 when a showcase package.json is statable but unreadable (mode 0000 file, readable parent)",
    () => {
      withTmp((tmp) => {
        const slug = "mastra";
        const examplesDir = path.join(tmp, "examples", "integrations");
        const packagesDir = path.join(tmp, "showcase", "packages");
        const exampleSlugDir = path.join(examplesDir, slug);
        const pkgSlugDir = path.join(packagesDir, slug);
        fs.mkdirSync(exampleSlugDir, { recursive: true });
        fs.mkdirSync(pkgSlugDir, { recursive: true });
        write(
          path.join(exampleSlugDir, "package.json"),
          JSON.stringify({ name: slug, dependencies: {} }),
        );
        const pkgFile = path.join(pkgSlugDir, "package.json");
        write(pkgFile, JSON.stringify({ name: slug, dependencies: {} }));

        // Mode-0000 on the FILE with a normal-mode parent: statSync on
        // the file succeeds (metadata is in the parent dir inode),
        // so the stat guard in collectDepsFromDir passes and the
        // error surfaces from readFileSync instead. This specifically
        // exercises the classification fix at the parsePackageJson
        // catch site — an EACCES here used to route to EXIT_DRIFT (1)
        // because `infra: true` was not set.
        fs.chmodSync(pkgFile, 0o000);

        try {
          const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
            env: {
              ...process.env,
              VALIDATE_PINS_REPO_ROOT: tmp,
            },
            encoding: "utf-8",
            timeout: 30_000,
          });
          // Must be EXIT_UNREADABLE (3), NOT EXIT_DRIFT (1).
          expect(r.status, r.stdout + r.stderr).toBe(3);
        } finally {
          try {
            fs.chmodSync(pkgFile, 0o644);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[validate-pins test] failed to restore perms on ${pkgFile} (possible leak): ${msg}`,
            );
          }
        }
      });
    },
  );
});

describe("validateAll: readdirSync(PACKAGES_DIR) failure routes to EXIT_UNREADABLE", () => {
  it.skipIf(cannotEnforceEacces)(
    "exits 3 when PACKAGES_DIR is traverseable but not readable",
    () => {
      withTmp((tmp) => {
        const packagesDir = path.join(tmp, "showcase", "packages");
        const examplesDir = path.join(tmp, "examples", "integrations");
        fs.mkdirSync(packagesDir, { recursive: true });
        fs.mkdirSync(examplesDir, { recursive: true });
        // Create one slug inside so the dir isn't legitimately empty —
        // we want readdir to FAIL, not return [].
        fs.mkdirSync(path.join(packagesDir, "mastra"), { recursive: true });

        // Mode 0o111: executable (traverseable) but not readable. On
        // platforms that enforce chmod for non-root, statSync succeeds
        // (metadata is in the parent) but readdirSync throws EACCES.
        fs.chmodSync(packagesDir, 0o111);

        try {
          const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
            env: {
              ...process.env,
              VALIDATE_PINS_REPO_ROOT: tmp,
            },
            encoding: "utf-8",
            timeout: 30_000,
          });
          // Must be EXIT_UNREADABLE (3), NOT EXIT_INTERNAL (2) which
          // is the pre-fix behaviour (unwrapped readdir error
          // propagating to the generic top-level catch).
          expect(r.status, r.stdout + r.stderr).toBe(3);
        } finally {
          try {
            fs.chmodSync(packagesDir, 0o755);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[validate-pins test] failed to restore perms on ${packagesDir} (possible leak): ${msg}`,
            );
          }
        }
      });
    },
  );
});
