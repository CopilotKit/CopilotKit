import { afterEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Repo root is two directories above this test file
// (showcase/scripts/__tests__/X -> showcase/scripts -> showcase -> <repo>).
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const CONFIG_PATH = join(REPO_ROOT, ".oxlintrc.json");
const RULE_MODULE_PATH = join(
  REPO_ROOT,
  "packages",
  "react-ui",
  "oxlint-rules",
  "no-public-env-shell-read.mjs",
);

// Import BANNED_KEYS from the rule module itself (rather than hand-mirroring
// the list) so the table-driven coverage cannot drift from the rule's true
// banned set. If someone adds a new banned key to the rule and forgets the
// test, the test set still expands automatically; if someone removes a key
// from the rule, the test set contracts. The assertion is "the rule is
// exhaustively table-driven against its own banned set."
const ruleModule = (await import(pathToFileURL(RULE_MODULE_PATH).href)) as {
  BANNED_KEYS: Set<string>;
};
if (
  !ruleModule.BANNED_KEYS ||
  !(ruleModule.BANNED_KEYS instanceof Set) ||
  ruleModule.BANNED_KEYS.size === 0
) {
  throw new Error(
    `Rule module did not export a non-empty BANNED_KEYS Set: ${RULE_MODULE_PATH}`,
  );
}
const BANNED_KEYS = [...ruleModule.BANNED_KEYS] as readonly string[];

const ALLOWED_KEYS = [
  "NEXT_PUBLIC_COMMIT_SHA",
  "NEXT_PUBLIC_BRANCH",
  "NEXT_PUBLIC_LOCAL_BACKENDS",
] as const;

// Track every fixture we stage so afterEach reaps them — even on a thrown
// assertion mid-test. Without a centralized tracker, a thrown expect()
// inside a try/finally branch can still leave a file behind if the cleanup
// path itself diverges across tests.
const stagedPaths: string[] = [];

function stageFile(absPath: string, source: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, source, "utf8");
  stagedPaths.push(absPath);
}

afterEach(() => {
  while (stagedPaths.length > 0) {
    const p = stagedPaths.pop();
    if (p) rmSync(p, { force: true });
  }
});

interface LintOutcome {
  exitCode: number;
  combined: string;
}

function runOxlint(target: string): LintOutcome {
  try {
    const stdout = execSync(`npx oxlint -c ${CONFIG_PATH} ${target} --quiet`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO_ROOT,
    }).toString();
    return { exitCode: 0, combined: stdout };
  } catch (e) {
    const err = e as {
      status?: number;
      stderr?: Buffer | string;
      stdout?: Buffer | string;
    };
    const stderr = err.stderr?.toString() ?? "";
    const stdout = err.stdout?.toString() ?? "";
    return { exitCode: err.status ?? 1, combined: stderr + stdout };
  }
}

function shellFixturePath(name: string): string {
  return join(
    REPO_ROOT,
    "showcase",
    "shell-dashboard",
    "src",
    "lib",
    `${name}.lintfixture.tsx`,
  );
}

describe("oxlint copilotkit/no-public-env-shell-read NEXT_PUBLIC_* guard", () => {
  describe("banned-key coverage (all variants flagged)", () => {
    for (const key of BANNED_KEYS) {
      it(`flags process.env.${key} (dotted member)`, () => {
        const target = shellFixturePath(`bad-dotted-${key}`);
        stageFile(target, `export const x = process.env.${key};\n`);
        const r = runOxlint(target);
        expect(r.exitCode).not.toBe(0);
        expect(r.combined).toMatch(/no-public-env-shell-read/);
        expect(r.combined).toMatch(/getRuntimeConfig/);
      });

      it(`flags process.env["${key}"] (bracket-string member)`, () => {
        const target = shellFixturePath(`bad-bracket-${key}`);
        stageFile(target, `export const x = process.env["${key}"];\n`);
        const r = runOxlint(target);
        expect(r.exitCode).not.toBe(0);
        expect(r.combined).toMatch(/no-public-env-shell-read/);
      });
    }
  });

  describe("allowed-key non-firing (build-stamps + computed local-dev value)", () => {
    for (const key of ALLOWED_KEYS) {
      it(`does NOT flag process.env.${key}`, () => {
        const target = shellFixturePath(`ok-${key}`);
        stageFile(target, `export const x = process.env.${key};\n`);
        const r = runOxlint(target);
        expect(r.exitCode).toBe(0);
      });
    }
  });

  describe("variant coverage (destructuring / optional chaining / template-key)", () => {
    it("flags const { NEXT_PUBLIC_SHELL_URL } = process.env (destructuring)", () => {
      const target = shellFixturePath("bad-destructure");
      stageFile(
        target,
        `const { NEXT_PUBLIC_SHELL_URL } = process.env;\nexport const x = NEXT_PUBLIC_SHELL_URL;\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toMatch(/no-public-env-shell-read/);
    });

    it("flags const { NEXT_PUBLIC_SHELL_URL: aliased } = process.env (destructuring with alias)", () => {
      const target = shellFixturePath("bad-destructure-aliased");
      stageFile(
        target,
        `const { NEXT_PUBLIC_SHELL_URL: aliased } = process.env;\nexport const x = aliased;\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toMatch(/no-public-env-shell-read/);
    });

    it("flags process.env?.NEXT_PUBLIC_SHELL_URL (optional chaining)", () => {
      const target = shellFixturePath("bad-optchain");
      stageFile(
        target,
        `export const x = process.env?.NEXT_PUBLIC_SHELL_URL;\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toMatch(/no-public-env-shell-read/);
    });

    it("flags process.env[`NEXT_PUBLIC_SHELL_URL`] (no-expression template literal key)", () => {
      const target = shellFixturePath("bad-tplkey");
      stageFile(
        target,
        "export const x = process.env[`NEXT_PUBLIC_SHELL_URL`];\n",
      );
      const r = runOxlint(target);
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toMatch(/no-public-env-shell-read/);
    });

    it('flags const { ["NEXT_PUBLIC_SHELL_URL"]: x } = process.env (destructuring with computed string key)', () => {
      // Parity with the bracket-member form: the destructuring branch
      // must apply the same staticKeyName() recognition as the member
      // branch, otherwise a computed string key sneaks through.
      const target = shellFixturePath("bad-destructure-computed-string");
      stageFile(
        target,
        `const { ["NEXT_PUBLIC_SHELL_URL"]: x } = process.env;\nexport const y = x;\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toMatch(/no-public-env-shell-read/);
    });

    it("flags const { [`NEXT_PUBLIC_SHELL_URL`]: x } = process.env (destructuring with no-expression template key)", () => {
      const target = shellFixturePath("bad-destructure-computed-template");
      stageFile(
        target,
        "const { [`NEXT_PUBLIC_SHELL_URL`]: x } = process.env;\nexport const y = x;\n",
      );
      const r = runOxlint(target);
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toMatch(/no-public-env-shell-read/);
    });

    it("does NOT flag process.env.NEXT_PUBLIC_SHELL_URL = ... (assignment LHS)", () => {
      // Writes (test/runtime overrides) are intentionally not flagged.
      const target = shellFixturePath("ok-assign");
      stageFile(
        target,
        `process.env.NEXT_PUBLIC_SHELL_URL = "x";\nexport {};\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).toBe(0);
    });

    it("does NOT flag delete process.env.NEXT_PUBLIC_SHELL_URL", () => {
      const target = shellFixturePath("ok-delete");
      stageFile(
        target,
        `delete process.env.NEXT_PUBLIC_SHELL_URL;\nexport {};\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).toBe(0);
    });
  });

  describe("override scoping (shell-only enforcement; runtime-config + non-shell exempt)", () => {
    it("does NOT flag inside a runtime-config implementation file (off-override)", () => {
      // The off-override matches `showcase/**/lib/runtime-config*.{ts,tsx}`
      // (and the `.client` variant). Confirm the rule is silenced there.
      const target = join(
        REPO_ROOT,
        "showcase",
        "shell-dashboard",
        "src",
        "lib",
        "runtime-config.lintfixture.tsx",
      );
      stageFile(
        target,
        `export const x = process.env.NEXT_PUBLIC_SHELL_URL;\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).toBe(0);
    });

    it("does NOT flag inside packages/ (outside the shell trees)", () => {
      const target = join(
        REPO_ROOT,
        "packages",
        "react-ui",
        "src",
        "__noflag.lintfixture.tsx",
      );
      stageFile(
        target,
        `export const x = process.env.NEXT_PUBLIC_SHELL_URL;\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).toBe(0);
    });

    it("DOES flag inside shell-docs/src (shell-tree, not runtime-config)", () => {
      const target = join(
        REPO_ROOT,
        "showcase",
        "shell-docs",
        "src",
        "__bad.lintfixture.tsx",
      );
      stageFile(
        target,
        `export const x = process.env.NEXT_PUBLIC_SHELL_URL;\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toMatch(/no-public-env-shell-read/);
    });

    it("DOES flag inside shell/src (shell-tree)", () => {
      // The override list in .oxlintrc.json includes showcase/shell/src/**;
      // exercise that branch explicitly so a future override-list edit that
      // accidentally drops `shell` is caught.
      const target = join(
        REPO_ROOT,
        "showcase",
        "shell",
        "src",
        "__bad.lintfixture.tsx",
      );
      stageFile(
        target,
        `export const x = process.env.NEXT_PUBLIC_SHELL_URL;\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toMatch(/no-public-env-shell-read/);
    });

    it("DOES flag inside shell-dojo/src (shell-tree)", () => {
      // Same as above for the dojo shell tree.
      const target = join(
        REPO_ROOT,
        "showcase",
        "shell-dojo",
        "src",
        "__bad.lintfixture.tsx",
      );
      stageFile(
        target,
        `export const x = process.env.NEXT_PUBLIC_SHELL_URL;\n`,
      );
      const r = runOxlint(target);
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toMatch(/no-public-env-shell-read/);
    });
  });
});
