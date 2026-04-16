import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  parsePackageJson,
  parsePyprojectToml,
  parseRequirementsLine,
  canonicalizePythonName,
  isExactSpec,
  collectDojoDeps,
  validateAll,
  isMainPath,
  isFrameworkDep,
} from "../validate-pins.js";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "pins");

function tmpdir(prefix = "validate-pins-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
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
});

describe("parsePyprojectToml", () => {
  it("parses [project].dependencies even when optional-dependencies appears before", () => {
    const file = path.join(FIXTURES_DIR, "pyproject-optional-first.toml");
    const deps = parsePyprojectToml(file);
    expect(deps["langgraph"]).toBe("==0.2.14");
    expect(deps["copilotkit"]).toBe("==1.10.0");
    // Must NOT pick up "ruff" from optional-dependencies above
    expect(deps["ruff"]).toBeUndefined();
  });

  it("parses Poetry [tool.poetry.dependencies] table format", () => {
    const file = path.join(FIXTURES_DIR, "pyproject-poetry.toml");
    const deps = parsePyprojectToml(file);
    expect(deps["langgraph"]).toBe("0.2.14");
    expect(deps["copilotkit"]).toBe("1.10.0");
    expect(deps["pydantic-ai"]).toBe("0.0.20");
    // Must not include python marker
    expect(deps["python"]).toBeUndefined();
  });

  it("does not truncate dependencies at [project.optional-dependencies] subtable", () => {
    const file = path.join(FIXTURES_DIR, "pyproject-with-subtable.toml");
    const deps = parsePyprojectToml(file);
    expect(deps["langgraph"]).toBe("==0.2.14");
    expect(deps["copilotkit"]).toBe("==1.10.0");
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
    const failForMastra = report.fail.some(
      (l) => l.includes(slug) && l.includes("@mastra/core"),
    );
    expect(failForMastra).toBe(true);
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
    const failForMastra = report.fail.some(
      (l) => l.includes(slug) && l.includes("@mastra/core"),
    );
    expect(failForMastra).toBe(true);
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
    const drift = report.fail.some(
      (l) =>
        l.includes(slug) && l.includes("@mastra/core") && /absent/i.test(l),
    );
    expect(drift).toBe(true);
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
    const flagged = report.fail.some(
      (l) => l.includes(slug) && /langgraph[-_]checkpoint/.test(l),
    );
    expect(flagged).toBe(true);
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
});

describe("FRAMEWORK_PATTERNS coverage", () => {
  it("matches ag2, langroid, llama_index underscore form", () => {
    expect(isFrameworkDep("ag2")).toBe(true);
    expect(isFrameworkDep("langroid")).toBe(true);
    expect(isFrameworkDep("llama_index")).toBe(true);
  });
});
