import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  dedupeDiagnostics,
  isLintable,
  knipFindings,
  oxlintFindings,
  parseGateArgs,
  toRepoPath,
} from "../lint/gate.js";
import type { KnipReport, OxlintDiagnostic } from "../lint/gate.js";

const ROOT = path.resolve("/repo");
const ASSERTION = "typescript-eslint(no-unnecessary-type-assertion)";
const ANY = "typescript-eslint(no-explicit-any)";
const FILE = "packages/core/src/index.ts";

function diagnostic(overrides: Partial<OxlintDiagnostic> = {}) {
  const base: OxlintDiagnostic = {
    code: ASSERTION,
    severity: "error",
    filename: FILE,
    message: "This assertion is unnecessary.",
    labels: [{ span: { offset: 120, length: 9, line: 7, column: 3 } }],
  };
  return { ...base, ...overrides };
}

function at(offset: number, length: number, line = 7) {
  return [{ span: { offset, length, line, column: 3 } }];
}

describe("toRepoPath", () => {
  it("makes an absolute path under the root repo-relative", () => {
    expect(toRepoPath(path.join(ROOT, "packages", "a", "x.ts"), ROOT)).toBe(
      "packages/a/x.ts",
    );
  });

  it("drops a leading ./", () => {
    expect(toRepoPath("./packages/a/x.ts", ROOT)).toBe("packages/a/x.ts");
  });

  it("keeps a path outside the root as ../", () => {
    expect(toRepoPath(path.resolve(ROOT, "..", "other", "x.ts"), ROOT)).toBe(
      "../other/x.ts",
    );
  });
});

describe("isLintable", () => {
  it("accepts a source file in the repo", () => {
    expect(isLintable("packages/a/src/view.tsx")).toBe(true);
  });

  it("ignores a file oxlint does not lint", () => {
    expect(isLintable("packages/a/README.md")).toBe(false);
  });

  it("ignores a file outside the repo", () => {
    expect(isLintable("../other/x.ts")).toBe(false);
  });
});

describe("dedupeDiagnostics", () => {
  it("keeps one copy of a diagnostic that both passes report", () => {
    const pass1 = [diagnostic()];
    const pass2 = [diagnostic(), diagnostic({ code: ANY, labels: at(300, 3) })];

    expect(dedupeDiagnostics([...pass1, ...pass2])).toEqual([
      diagnostic(),
      diagnostic({ code: ANY, labels: at(300, 3) }),
    ]);
  });

  it("keeps two diagnostics at the same offset with different lengths", () => {
    // `(x as A) as B`: both assertions start at the same offset.
    const outer = diagnostic({ labels: at(120, 13) });
    const inner = diagnostic({ labels: at(120, 9) });

    expect(dedupeDiagnostics([outer, inner])).toEqual([outer, inner]);
  });

  it("keeps the same span in two files", () => {
    const other = diagnostic({ filename: "packages/a/src/b.ts" });

    expect(dedupeDiagnostics([diagnostic(), other])).toEqual([
      diagnostic(),
      other,
    ]);
  });

  it("keeps one copy of a repeated diagnostic with no code", () => {
    const parseError = diagnostic({
      code: undefined,
      message: "Unexpected token",
    });

    expect(dedupeDiagnostics([parseError, parseError])).toEqual([parseError]);
  });
});

describe("oxlintFindings", () => {
  it("gates errors only and counts the other diagnostics as warnings", () => {
    const result = oxlintFindings(
      [
        diagnostic(),
        diagnostic({ code: ANY, severity: "warning", labels: at(300, 3) }),
        diagnostic({ code: ANY, severity: "advice", labels: at(400, 3) }),
      ],
      ROOT,
    );

    expect(result).toEqual({
      errors: [
        {
          rule: ASSERTION,
          file: FILE,
          line: 7,
          message: "This assertion is unnecessary.",
        },
      ],
      warnings: 2,
    });
  });

  it("counts an error with no code as a parse error", () => {
    const parseError = diagnostic({
      code: undefined,
      message: "Unexpected token",
      labels: at(10, 1, 1),
    });

    expect(oxlintFindings([parseError], ROOT).errors).toEqual([
      {
        rule: "oxc(parse-error)",
        file: FILE,
        line: 1,
        message: "Unexpected token",
      },
    ]);
  });

  it("makes an absolute filename repo-relative", () => {
    const absolute = diagnostic({ filename: path.join(ROOT, FILE) });

    expect(oxlintFindings([absolute], ROOT).errors[0].file).toBe(FILE);
  });

  it("uses line 0 when the diagnostic has no label", () => {
    const unlabelled = diagnostic({ labels: [] });

    expect(oxlintFindings([unlabelled], ROOT).errors[0].line).toBe(0);
  });
});

describe("knipFindings", () => {
  // Trimmed from a real `knip --reporter json` run (knip 5.88).
  const report: KnipReport = {
    files: ["packages/react-native/src/components/messages/index.ts"],
    issues: [
      {
        file: "packages/angular/package.json",
        owners: [{ name: "@wolfmanfx" }],
        dependencies: [],
        devDependencies: [
          { name: "chokidar", line: 92, col: 6, pos: 3201 },
          { name: "rimraf", line: 96, col: 6, pos: 3312 },
        ],
        unlisted: [],
        binaries: [],
        exports: [],
        types: [],
      },
      {
        file: "packages/web-inspector/vitest.config.ts",
        owners: [],
        dependencies: [],
        devDependencies: [],
        unlisted: [{ name: "jsdom" }],
        binaries: [{ name: "tsx" }],
        exports: [],
        types: [],
      },
      {
        file: "packages/runtime/src/runtime/core/middleware.ts",
        owners: [],
        dependencies: [],
        devDependencies: [],
        unlisted: [],
        binaries: [],
        exports: [
          { name: "isPlatformNotFoundError", line: 23, col: 17, pos: 500 },
        ],
        types: [
          { name: "CopilotKitMiddlewareEvent", line: 56, col: 13, pos: 2035 },
        ],
      },
      {
        file: "packages/shared/src/utils/errors.ts",
        owners: [],
        duplicates: [
          [
            { name: "BANNER_ERROR_NAMES", line: 28, col: 13, pos: 1148 },
            { name: "COPILOT_CLOUD_ERROR_NAMES", line: 38, col: 41, pos: 1535 },
          ],
        ],
        enumMembers: {
          ErrorVisibility: [{ name: "SILENT", line: 10, col: 3, pos: 387 }],
        },
      },
    ],
  };

  it("gives one finding per reported item, with the type as the rule", () => {
    expect(knipFindings(report, ROOT)).toEqual([
      {
        rule: "knip(files)",
        file: "packages/react-native/src/components/messages/index.ts",
        line: 0,
        message: "unused file",
      },
      {
        rule: "knip(devDependencies)",
        file: "packages/angular/package.json",
        line: 92,
        message: "chokidar",
      },
      {
        rule: "knip(devDependencies)",
        file: "packages/angular/package.json",
        line: 96,
        message: "rimraf",
      },
      {
        rule: "knip(unlisted)",
        file: "packages/web-inspector/vitest.config.ts",
        line: 0,
        message: "jsdom",
      },
      {
        rule: "knip(binaries)",
        file: "packages/web-inspector/vitest.config.ts",
        line: 0,
        message: "tsx",
      },
      {
        rule: "knip(exports)",
        file: "packages/runtime/src/runtime/core/middleware.ts",
        line: 23,
        message: "isPlatformNotFoundError",
      },
      {
        rule: "knip(types)",
        file: "packages/runtime/src/runtime/core/middleware.ts",
        line: 56,
        message: "CopilotKitMiddlewareEvent",
      },
      {
        rule: "knip(duplicates)",
        file: "packages/shared/src/utils/errors.ts",
        line: 28,
        message: "BANNER_ERROR_NAMES = COPILOT_CLOUD_ERROR_NAMES",
      },
      {
        rule: "knip(enumMembers)",
        file: "packages/shared/src/utils/errors.ts",
        line: 10,
        message: "SILENT",
      },
    ]);
  });

  it("returns no findings for a clean report", () => {
    expect(knipFindings({ files: [], issues: [] }, ROOT)).toEqual([]);
  });
});

describe("parseGateArgs", () => {
  const file = path.join(ROOT, FILE);

  it("checks the whole repo with oxlint by default", () => {
    expect(parseGateArgs([], ROOT)).toEqual({
      source: "oxlint",
      mode: "check",
      fix: false,
      files: undefined,
      help: false,
    });
  });

  it("takes a file list as repo-relative paths", () => {
    expect(parseGateArgs(["--fix", "--", file], ROOT)).toEqual({
      source: "oxlint",
      mode: "check",
      fix: true,
      files: [FILE],
      help: false,
    });
  });

  it("reads the prune mode for knip", () => {
    expect(parseGateArgs(["--source", "knip", "--prune"], ROOT).mode).toBe(
      "prune",
    );
  });

  it("rejects a file list with --prune", () => {
    expect(() => parseGateArgs(["--prune", file], ROOT)).toThrow(
      /need a full run/,
    );
  });

  it("rejects a file list with --write-baseline", () => {
    expect(() => parseGateArgs(["--write-baseline", file], ROOT)).toThrow(
      /need a full run/,
    );
  });

  it("rejects --prune with --write-baseline", () => {
    expect(() => parseGateArgs(["--prune", "--write-baseline"], ROOT)).toThrow(
      /not both/,
    );
  });

  it("rejects --fix for knip", () => {
    expect(() => parseGateArgs(["--source", "knip", "--fix"], ROOT)).toThrow(
      /oxlint only/,
    );
  });

  it("rejects an unknown source", () => {
    expect(() => parseGateArgs(["--source", "eslint"], ROOT)).toThrow(
      /"oxlint" or "knip"/,
    );
  });

  it("rejects an unknown option", () => {
    expect(() => parseGateArgs(["--frobnicate"], ROOT)).toThrow();
  });
});
