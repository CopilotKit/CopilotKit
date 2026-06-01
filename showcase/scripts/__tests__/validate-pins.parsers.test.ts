// Split from validate-pins.test.ts — see validate-pins.shared.ts header
// for the full rationale (vitest birpc 60s cliff, fork-per-file).

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  parsePackageJson,
  parsePyprojectToml,
  parsePyprojectTomlDetailed,
  parseRequirementsLine,
  parseRequirementsTxt,
  parseRequirementsTxtDetailed,
  canonicalizePythonName,
  isExactSpec,
  isFrameworkDep,
} from "../validate-pins.js";
import {
  FIXTURES_DIR,
  VALIDATE_PINS_SCRIPT,
  write,
  withTmp,
} from "./validate-pins.shared.js";

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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
      const file = path.join(tmp, "package.json");
      write(file, "[1, 2, 3]");
      expect(() => parsePackageJson(file)).toThrow(/object/i);
    });
  });

  it("throws when JSON top-level is null", () => {
    withTmp((tmp: string) => {
      const file = path.join(tmp, "package.json");
      write(file, "null");
      expect(() => parsePackageJson(file)).toThrow(/object/i);
    });
  });

  it("throws when JSON top-level is a scalar", () => {
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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

  // A pyproject.toml that DECLARES `dependencies = …` but produces zero
  // extracted entries AND no skipped/dropped diagnostics is almost
  // certainly malformed in a way the regex-based parser can't localize
  // — silently returning {} would render a false-clean [OK] for a file
  // the validator never actually inspected. Surface this as a parseError.
  //
  // Files that simply do NOT declare a `dependencies` key (tool-only
  // configs, `[project]` metadata-only blocks) must be accepted silently
  // as empty DepMaps — that is the correct, intended result, not a bug.
  it("returns empty DepMap silently for tool-only configs (e.g. [tool.black])", () => {
    withTmp((tmp: string) => {
      const file = path.join(tmp, "pyproject.toml");
      // Pure formatter config — no [project], no dependency tables.
      write(
        file,
        [
          "[tool.black]",
          "line-length = 100",
          'target-version = ["py311"]',
        ].join("\n"),
      );
      const result = parsePyprojectTomlDetailed(file);
      expect(result.deps).toEqual({});
      expect(result.skipped).toEqual([]);
      expect(result.dropped).toEqual([]);
    });
  });

  it("returns empty DepMap silently for [project] metadata-only blocks (no dependencies key)", () => {
    withTmp((tmp: string) => {
      const file = path.join(tmp, "pyproject.toml");
      // Valid PEP 621 metadata-only block — name/version/authors but no
      // `dependencies` key. This is a legitimate shape for packages that
      // declare no runtime deps.
      write(
        file,
        [
          "[project]",
          'name = "metadata-only"',
          'version = "0.1.0"',
          'authors = [{ name = "Jane", email = "jane@example.com" }]',
        ].join("\n"),
      );
      const result = parsePyprojectTomlDetailed(file);
      expect(result.deps).toEqual({});
      expect(result.skipped).toEqual([]);
      expect(result.dropped).toEqual([]);
    });
  });

  it('throws when `dependencies = "malformed"` is a string (wrong TOML type)', () => {
    withTmp((tmp: string) => {
      const file = path.join(tmp, "pyproject.toml");
      // `dependencies` is declared but as a string, not an array. The
      // targeted regexes don't match this shape, so extraction produces
      // nothing — which must surface as a parseError rather than a
      // false-clean [OK].
      write(
        file,
        [
          "[project]",
          'name = "bad-deps"',
          'version = "0.1.0"',
          'dependencies = "not-an-array"',
        ].join("\n"),
      );
      expect(() => parsePyprojectTomlDetailed(file)).toThrow(/empty DepMap/i);
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
describe("parseRequirementsTxt (file-level)", () => {
  it("handles multi-line files with comments, blanks, extras, and flags", () => {
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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

  // The Python `==` body regex must be anchored end-to-end so that
  // degenerate bodies — non-numeric patch segments, illegal trailing
  // punctuation — do not sneak through as "starts with MAJOR.MINOR"
  // and get mis-classified as exact pins.
  it("rejects Python == specs with malformed bodies", () => {
    expect(isExactSpec("==1.2.foo")).toBe(false);
    expect(isExactSpec("==1.2abc!")).toBe(false);
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
describe("parsePyprojectToml Poetry bare version semantics", () => {
  it("marks bare Poetry versions as non-exact (Poetry treats them as ^)", () => {
    withTmp((tmp: string) => {
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
describe("parsePyprojectToml Poetry group sections", () => {
  it("parses [tool.poetry.group.<name>.dependencies] tables", () => {
    withTmp((tmp: string) => {
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
describe("parsePyprojectToml [project] terminates at dotted top-level headers", () => {
  it("does not bleed content after [tool.poetry] into [project] dependencies array", () => {
    withTmp((tmp: string) => {
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
describe("parsePyprojectToml precedence: [project] before Poetry", () => {
  it("PEP 621 [project] deps win over Poetry for the same name", () => {
    withTmp((tmp: string) => {
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
describe("[project].dependencies extras-syntax handling", () => {
  it("does NOT truncate at `]` embedded in `langchain[all]==1.2.3`", () => {
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
describe("[project.optional-dependencies] extras-syntax handling", () => {
  it("extras-syntax does not truncate optional-dependencies subkey arrays", () => {
    withTmp((tmp: string) => {
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
describe("balanced-bracket unterminated-array enforcement", () => {
  it("throws on `dependencies = [` with no closing `]` (even when another `]` appears later in the file)", () => {
    withTmp((tmp: string) => {
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
describe("Poetry array-form dep surfaces in skipped[]", () => {
  it('records `foo = ["^1.0", "^2.0"]` as skipped with a reason', () => {
    withTmp((tmp: string) => {
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
describe("Poetry caret-prefix does not fire on comma-joined ranges", () => {
  it('leaves `"1.2.3,>=1.0"` verbatim (no leading `^`)', () => {
    withTmp((tmp: string) => {
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

  // Pipe-OR / space / range-operator composed specs also start with a
  // digit but are NOT bare versions. Prefixing any of them with `^`
  // produces a nonsense value (e.g. `^1.2.3 || 2.0.0`), so they must
  // be stored verbatim and classified as non-exact on their own merits.
  it('leaves `"1.2.3 || 2.0.0"` verbatim (no leading `^`)', () => {
    withTmp((tmp: string) => {
      const file = path.join(tmp, "pyproject.toml");
      write(
        file,
        [
          "[tool.poetry.dependencies]",
          'python = "^3.10"',
          'foo = "1.2.3 || 2.0.0"',
        ].join("\n"),
      );
      const deps = parsePyprojectToml(file);
      expect(deps["foo"]).toBe("1.2.3 || 2.0.0");
      expect(isExactSpec(deps["foo"])).toBe(false);
    });
  });
});
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
  });

  // Bare MAJOR-only specs (e.g. `"1"`) are rejected for symmetry with the
  // Python `==` form — `==1` was already rejected because the PEP 440
  // body requires MAJOR.MINOR. Before the tightening, `"1"` passed the
  // bare npm path while `"==1"` failed, producing asymmetric drift
  // behavior across ecosystems.
  it("rejects bare MAJOR-only versions (symmetry with ==1 rejection)", () => {
    expect(isExactSpec("1")).toBe(false);
    expect(isExactSpec("2")).toBe(false);
    expect(isExactSpec("==1")).toBe(false);
  });
});
describe("Poetry non-string dep value surfaces in skipped[]", () => {
  it("records `foo = true` as skipped with a reason naming the type", () => {
    withTmp((tmp: string) => {
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
describe("Poetry unterminated string value is distinguished from empty", () => {
  it('reports `foo = "1.2.3` as unterminated, not empty', () => {
    withTmp((tmp: string) => {
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
describe("unterminated optional-dependencies subkey array is a parseError", () => {
  it("throws on unterminated optional-dependencies subkey array", () => {
    withTmp((tmp: string) => {
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
describe("pyproject name-only dep surfaces in skipped[]", () => {
  it('records `["foo"]` as skipped, not admitted to deps with empty spec', () => {
    withTmp((tmp: string) => {
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
describe("parseRequirementsTxt wrapper throws on skipped/dropped", () => {
  it("throws when the file contains a skipped (name-only) entry", () => {
    withTmp((tmp: string) => {
      const file = path.join(tmp, "requirements.txt");
      // name-only line becomes `skipped` in the detailed form.
      write(file, ["langgraph", "copilotkit==1.10.0"].join("\n"));
      expect(() => parseRequirementsTxt(file)).toThrow(
        /parseRequirementsTxt.*skipped/i,
      );
    });
  });

  it("throws when the file contains a dropped (unparseable) line", () => {
    withTmp((tmp: string) => {
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
      expect(() => parseRequirementsTxt(file)).toThrow(/parseRequirementsTxt/i);
    });
  });

  it("returns DepMap cleanly when no skipped/dropped entries", () => {
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
    withTmp((tmp: string) => {
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
