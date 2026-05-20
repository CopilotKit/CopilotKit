// Split from validate-pins.test.ts — see validate-pins.shared.ts header
// for the full rationale (vitest birpc 60s cliff, fork-per-file).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { validateAll } from "../validate-pins.js";
import {
  VALIDATE_PINS_SCRIPT,
  tmpdir,
  write,
  withTmp,
} from "./validate-pins.shared.js";

describe("R29-2 C1: infra error mid-loop does not orphan the report", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "integrations"), {
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

  // Set up two slugs in alphabetical order: "agno" (infra error) and
  // "mastra" (normal drift). Trigger an infra ENOTDIR on agno by
  // creating `apps/agent` as a FILE (not a directory), so that
  // `apps/agent/package.json` stats with ENOTDIR → infra=true.
  function wireInfraOnAgnoPlusDriftOnMastra() {
    const agnoPkg = path.join(repoRoot, "showcase", "integrations", "agno");
    const agnoEx = path.join(repoRoot, "examples", "integrations", "agno");
    // Create `apps/agent` as a file so `apps/agent/package.json` stat
    // fails with ENOTDIR — portable across platforms, no chmod needed.
    fs.mkdirSync(path.join(agnoPkg, "apps"), { recursive: true });
    fs.writeFileSync(path.join(agnoPkg, "apps", "agent"), "not-a-dir", "utf-8");
    fs.mkdirSync(agnoEx, { recursive: true });

    const mastraPkg = path.join(repoRoot, "showcase", "integrations", "mastra");
    const mastraEx = path.join(repoRoot, "examples", "integrations", "mastra");
    write(
      path.join(mastraPkg, "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    write(
      path.join(mastraEx, "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: { "@mastra/core": "0.16.0" },
      }),
    );
  }

  it("in-process: UnreadableInputError carries the fully populated partial report", () => {
    wireInfraOnAgnoPlusDriftOnMastra();
    let thrown: unknown;
    try {
      validateAll();
    } catch (e) {
      thrown = e;
    }
    expect(thrown, "validateAll must throw on infra error").toBeDefined();
    // The thrown error must carry the partial report so the top-level
    // catch can print FAIL/WARN/SKIP for every slug that was processed
    // before the throw.
    const partial = (
      thrown as {
        partialReport?: {
          fail: readonly string[];
          warn: readonly string[];
          skip: readonly string[];
          ok: readonly string[];
        };
      }
    ).partialReport;
    expect(
      partial,
      "UnreadableInputError must carry a partialReport",
    ).toBeDefined();
    // Slug B (mastra) must have its drift captured on report.fail even
    // though slug A (agno) had an infra error.
    const mastraDrift = partial!.fail.some(
      (l) =>
        l.includes("mastra") &&
        l.includes("@mastra/core") &&
        /0\.15\.0/.test(l) &&
        /0\.16\.0/.test(l),
    );
    expect(
      mastraDrift,
      `expected a mastra drift FAIL in partial.fail; got: ${JSON.stringify(partial!.fail)}`,
    ).toBe(true);
  });

  it("subprocess: CLI exits 3 AND prints slug-B FAIL line on stdout/stderr", () => {
    wireInfraOnAgnoPlusDriftOnMastra();
    const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
      encoding: "utf-8",
      env: { ...process.env, VALIDATE_PINS_REPO_ROOT: repoRoot },
      timeout: 30_000,
    });
    // Exit code must still be EXIT_UNREADABLE (3) — infra error wins.
    expect(r.status, r.stdout + r.stderr).toBe(3);
    // AND the partial report for slug B (mastra) must be visible in
    // the combined output. FAIL lines go to stderr per the output
    // convention.
    const combined = `${r.stdout}\n${r.stderr}`;
    expect(combined).toMatch(/mastra/);
    expect(combined).toMatch(/@mastra\/core/);
  });
});
describe("R29-2 M3: computeRepoRoot routes ENOENT to EXIT_UNREADABLE (3)", () => {
  it("subprocess: nonexistent VALIDATE_PINS_REPO_ROOT exits 3, not 2", () => {
    const tmp = tmpdir();
    try {
      // Path definitely does not exist.
      const bogus = path.join(tmp, "definitely-not-here-xyz123");
      const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
        encoding: "utf-8",
        env: { ...process.env, VALIDATE_PINS_REPO_ROOT: bogus },
        timeout: 30_000,
      });
      expect(r.status, r.stdout + r.stderr).toBe(3);
      expect(r.stderr).toMatch(/does not exist/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
describe("R29-2 H7: canonicalizeDepMap surfaces conflicting duplicates as WARN", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "integrations"), {
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

  it("emits a WARN when two entries canonicalize to the same key with different specs", () => {
    const slug = "langgraph-python";
    const pkgDir = path.join(repoRoot, "showcase", "integrations", slug);
    const exDir = path.join(repoRoot, "examples", "integrations", slug);
    // Both lines canonicalize to `langgraph-checkpoint` under PEP 503,
    // but their version specs differ — a real-world smoke signal.
    write(
      path.join(pkgDir, "requirements.txt"),
      "langgraph_checkpoint==1.0.0\nlanggraph-checkpoint==2.0.0\n",
    );
    write(
      path.join(exDir, "requirements.txt"),
      "langgraph-checkpoint==1.0.0\n",
    );
    const report = validateAll();
    const collisionWarn = report.warn.find(
      (l) =>
        l.includes(slug) &&
        /langgraph[-_]checkpoint/.test(l) &&
        /1\.0\.0/.test(l) &&
        /2\.0\.0/.test(l),
    );
    expect(
      collisionWarn,
      `expected a canonical-collision WARN mentioning both specs; got warn=${JSON.stringify(report.warn)}`,
    ).toBeDefined();
  });
});
describe("R33-2 C1/H1: resolveExampleDirDetailed mid-loop throw preserves partial report", () => {
  let repoRoot: string;
  let savedRepoRoot: string | undefined;

  beforeEach(() => {
    savedRepoRoot = process.env.VALIDATE_PINS_REPO_ROOT;
    repoRoot = tmpdir();
    process.env.VALIDATE_PINS_REPO_ROOT = repoRoot;
    fs.mkdirSync(path.join(repoRoot, "examples", "integrations"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "showcase", "integrations"), {
      recursive: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedRepoRoot === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = savedRepoRoot;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  // Set up two slugs in alphabetical order: "agno" (infra error at
  // candidate examples-dir stat) and "mastra" (normal drift). The
  // candidate dir EXAMPLES_DIR/agno exists on disk, but `fs.statSync`
  // is hijacked to throw ENOTDIR specifically for that path — which
  // routes through `existsAsDir` in resolveExampleDirDetailed and
  // (before the fix) aborts the slug loop before mastra is processed.
  function wireResolveInfraOnAgnoPlusDriftOnMastra() {
    const agnoPkg = path.join(repoRoot, "showcase", "integrations", "agno");
    const agnoEx = path.join(repoRoot, "examples", "integrations", "agno");
    fs.mkdirSync(agnoPkg, { recursive: true });
    // Realistic agno manifest so, if the loop WERE to reach content
    // parsing for agno, it would succeed — the bug we're testing is
    // specifically the resolveExampleDirDetailed throw path.
    write(
      path.join(agnoPkg, "package.json"),
      JSON.stringify({ name: "agno", dependencies: { agno: "0.1.0" } }),
    );
    fs.mkdirSync(agnoEx, { recursive: true });
    write(
      path.join(agnoEx, "package.json"),
      JSON.stringify({ name: "agno", dependencies: { agno: "0.1.0" } }),
    );

    const mastraPkg = path.join(repoRoot, "showcase", "integrations", "mastra");
    const mastraEx = path.join(repoRoot, "examples", "integrations", "mastra");
    write(
      path.join(mastraPkg, "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: { "@mastra/core": "0.15.0" },
      }),
    );
    write(
      path.join(mastraEx, "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: { "@mastra/core": "0.16.0" },
      }),
    );

    // Hijack statSync ONLY for the agno examples-dir candidate so
    // existsAsDir inside resolveExampleDirDetailed throws
    // UnreadableInputError. Pass through everything else so
    // tmp-probe / packages-dir / mastra stats work normally.
    const realStatSync = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation((p, opts) => {
      if (typeof p === "string" && p === agnoEx) {
        const err = new Error(
          `ENOTDIR: not a directory, stat '${agnoEx}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOTDIR";
        throw err;
      }
      return realStatSync(p as fs.PathLike, opts as fs.StatSyncOptions);
    });
  }

  it("in-process: validateAll throws UnreadableInputError carrying partialReport with slug-B drift", () => {
    wireResolveInfraOnAgnoPlusDriftOnMastra();
    let thrown: unknown;
    try {
      validateAll();
    } catch (e) {
      thrown = e;
    }
    expect(
      thrown,
      "validateAll must throw when resolveExampleDirDetailed raises",
    ).toBeDefined();

    // Must carry the partial report — not a bare Error with no context.
    const partial = (
      thrown as {
        partialReport?: {
          fail: readonly string[];
          warn: readonly string[];
          skip: readonly string[];
          ok: readonly string[];
        };
      }
    ).partialReport;
    expect(
      partial,
      "UnreadableInputError from resolveExampleDirDetailed must carry a partialReport",
    ).toBeDefined();

    // Slug B (mastra) must have its drift captured on report.fail even
    // though slug A (agno) had a resolve-time infra error. This is the
    // core guarantee: mid-loop resolve failure does not orphan later
    // slugs' findings.
    const mastraDrift = partial!.fail.some(
      (l) =>
        l.includes("mastra") &&
        l.includes("@mastra/core") &&
        /0\.15\.0/.test(l) &&
        /0\.16\.0/.test(l),
    );
    expect(
      mastraDrift,
      `expected a mastra drift FAIL in partial.fail; got: ${JSON.stringify(partial!.fail)}`,
    ).toBe(true);
  });

  it("in-process: per-slug visibility preserved — agno appears in partial.fail as an infra-class entry", () => {
    wireResolveInfraOnAgnoPlusDriftOnMastra();
    let thrown: unknown;
    try {
      validateAll();
    } catch (e) {
      thrown = e;
    }
    const partial = (
      thrown as {
        partialReport?: {
          fail: readonly string[];
          warn: readonly string[];
          skip: readonly string[];
          ok: readonly string[];
        };
      }
    ).partialReport;
    expect(partial).toBeDefined();
    // The slug that triggered the resolve-time infra error must leave a
    // breadcrumb in the report so operators see which slug failed to
    // resolve — not a silent swallow.
    const agnoFail = partial!.fail.some(
      (l) => l.includes("agno") && /unreadable|ENOTDIR|cannot stat/i.test(l),
    );
    expect(
      agnoFail,
      `expected an agno resolve-infra FAIL breadcrumb; got: ${JSON.stringify(partial!.fail)}`,
    ).toBe(true);
  });
});
