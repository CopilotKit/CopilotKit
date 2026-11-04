import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  impeccableFindings,
  isReactManifest,
  keepTracked,
  outermostDirs,
  parseUiCheckArgs,
  reactDoctorFindings,
  reactProjectDirs,
} from "../lint/react-ui-checks.js";
import type {
  ImpeccableFinding,
  ReactDoctorDiagnostic,
  ReactDoctorReport,
} from "../lint/react-ui-checks.js";

const ROOT = path.resolve("/repo");

function diagnostic(overrides: Partial<ReactDoctorDiagnostic> = {}) {
  const base: ReactDoctorDiagnostic = {
    filePath: "src/App.tsx",
    plugin: "react-doctor",
    rule: "no-array-index-as-key",
    severity: "warning",
    title: "Array index used as a key",
    message: "Use a stable id as the key.",
    line: 12,
    offset: 300,
    length: 9,
  };
  return { ...base, ...overrides };
}

function report(
  projects: { dir: string; diagnostics: ReactDoctorDiagnostic[] }[],
) {
  const value: ReactDoctorReport = {
    ok: true,
    error: null,
    projects: projects.map(({ dir, diagnostics }) => ({
      directory: path.join(ROOT, dir),
      complete: true,
      diagnostics,
    })),
  };
  return value;
}

describe("isReactManifest", () => {
  it.each([
    ["dependencies", { dependencies: { react: "19" } }],
    ["peerDependencies", { peerDependencies: { react: ">=18" } }],
    ["devDependencies", { devDependencies: { react: "^19.1.0" } }],
  ])("is true when react is in %s", (_field, manifest) => {
    expect(isReactManifest(manifest)).toBe(true);
  });

  it("is false for a package that only names a react-* package", () => {
    expect(
      isReactManifest({ dependencies: { "react-dom": "19", "@a/react": "1" } }),
    ).toBe(false);
  });

  it("is false for a value that is not a manifest object", () => {
    expect(isReactManifest(null)).toBe(false);
    expect(isReactManifest(["react"])).toBe(false);
  });
});

describe("reactProjectDirs", () => {
  const manifests: Record<string, unknown> = {
    "packages/react-core/package.json": { peerDependencies: { react: "19" } },
    "packages/core/package.json": { dependencies: { rxjs: "7" } },
    "examples/v2/demo/package.json": { dependencies: { react: "19" } },
    "showcase/shell/package.json": { dependencies: { react: "19" } },
    "tools/genui-eval/package.json": { dependencies: { react: "19" } },
  };

  it("keeps React manifests under packages/, examples/, and showcase/ only", () => {
    const tracked = [...Object.keys(manifests), "packages/react-core/src/a.ts"];
    expect(reactProjectDirs(tracked, (file) => manifests[file])).toEqual([
      "examples/v2/demo",
      "packages/react-core",
      "showcase/shell",
    ]);
  });
});

describe("outermostDirs", () => {
  it("drops directories nested in another listed directory", () => {
    expect(
      outermostDirs([
        "examples/mcp-apps/threejs-server",
        "examples/mcp-apps",
        "examples/mcp-apps-other",
      ]),
    ).toEqual(["examples/mcp-apps", "examples/mcp-apps-other"]);
  });
});

describe("reactDoctorFindings", () => {
  it("makes paths repo-relative from the project directory and names the plugin", () => {
    const findings = reactDoctorFindings(
      report([{ dir: "examples/demo", diagnostics: [diagnostic()] }]),
      ROOT,
    );
    expect(findings).toEqual([
      {
        rule: "react-doctor/no-array-index-as-key",
        file: "examples/demo/src/App.tsx",
        line: 12,
        message: "Array index used as a key",
      },
    ]);
  });

  it("counts a diagnostic once when a parent and a nested project both report it", () => {
    const findings = reactDoctorFindings(
      report([
        {
          dir: "examples/app",
          diagnostics: [diagnostic({ filePath: "x/a.tsx" })],
        },
        {
          dir: "examples/app/x",
          diagnostics: [diagnostic({ filePath: "a.tsx" })],
        },
      ]),
      ROOT,
    );
    expect(findings.map((finding) => finding.file)).toEqual([
      "examples/app/x/a.tsx",
    ]);
  });

  it("keeps two hits of one rule at different spans in the same file", () => {
    const findings = reactDoctorFindings(
      report([
        {
          dir: "examples/demo",
          diagnostics: [diagnostic(), diagnostic({ offset: 400, line: 15 })],
        },
      ]),
      ROOT,
    );
    expect(findings).toHaveLength(2);
  });
});

describe("impeccableFindings", () => {
  const finding: ImpeccableFinding = {
    antipattern: "low-contrast",
    name: "Low contrast",
    severity: "warning",
    file: path.join(ROOT, "showcase/shell/src/a.css"),
    line: 4,
    snippet: "#999 on #fff",
  };

  it("turns a finding into a rule, a repo path, and a message with the snippet", () => {
    expect(impeccableFindings([finding], ROOT)).toEqual([
      {
        rule: "impeccable/low-contrast",
        file: "showcase/shell/src/a.css",
        line: 4,
        message: "Low contrast: #999 on #fff",
      },
    ]);
  });

  it("drops advisory findings", () => {
    expect(
      impeccableFindings([{ ...finding, severity: "advisory" }], ROOT),
    ).toEqual([]);
  });
});

describe("keepTracked", () => {
  it("keeps findings in tracked files and counts the rest", () => {
    const tracked = { rule: "r", file: "a.tsx", line: 1, message: "m" };
    const built = { ...tracked, file: "examples/demo/.next/a.js" };
    expect(keepTracked([tracked, built], new Set(["a.tsx"]))).toEqual({
      kept: [tracked],
      untracked: 1,
    });
  });
});

describe("parseUiCheckArgs", () => {
  it("reads the source and the mode", () => {
    expect(parseUiCheckArgs(["--source", "impeccable", "--prune"])).toEqual({
      source: "impeccable",
      mode: "prune",
      help: false,
    });
  });

  it("rejects a missing or unknown source", () => {
    expect(() => parseUiCheckArgs([])).toThrow(/--source must be/);
    expect(() => parseUiCheckArgs(["--source", "eslint"])).toThrow(
      /--source must be/,
    );
  });

  it("rejects --prune with --write-baseline", () => {
    expect(() =>
      parseUiCheckArgs([
        "--source",
        "react-doctor",
        "--prune",
        "--write-baseline",
      ]),
    ).toThrow(/not both/);
  });
});
