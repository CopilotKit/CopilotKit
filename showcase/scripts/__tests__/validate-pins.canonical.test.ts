// Tests for the showcase-internal pin invariant (Phase 1):
//
//   - Every `@copilotkit/*` dep in every showcase integration pins to
//     `canonicalCopilotKitVersion` from showcase-canonical-pins.json,
//     OR to a per-slug per-dep override.
//   - Every other framework dep is an exact pin (no ^/~/>=/latest/...).
//   - Workspace refs are skipped, not failed.
//
// The validator no longer reads `examples/integrations/` — that
// cross-product comparison was retired. These tests are the single
// authoritative test surface for the new invariant.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { validateAll } from "../validate-pins.js";
import { tmpdir, write } from "./validate-pins.shared.js";

interface Fixture {
  repoRoot: string;
  pkgsDir: string;
}

function makeFixture(canonical: {
  canonicalCopilotKitVersion?: string;
  overrides?: Record<string, Record<string, string>>;
}): Fixture {
  const repoRoot = tmpdir();
  const pkgsDir = path.join(repoRoot, "showcase", "integrations");
  fs.mkdirSync(pkgsDir, { recursive: true });
  write(
    path.join(repoRoot, "showcase", "scripts", "showcase-canonical-pins.json"),
    JSON.stringify({
      canonicalCopilotKitVersion:
        canonical.canonicalCopilotKitVersion ?? "1.59.2",
      overrides: canonical.overrides ?? {},
    }),
  );
  return { repoRoot, pkgsDir };
}

describe("showcase-internal canonical-pin invariant", () => {
  let saved: string | undefined;
  let repoRoot: string | undefined;

  beforeEach(() => {
    saved = process.env.VALIDATE_PINS_REPO_ROOT;
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.VALIDATE_PINS_REPO_ROOT;
    } else {
      process.env.VALIDATE_PINS_REPO_ROOT = saved;
    }
    if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("passes when all @copilotkit/* deps match canonical and framework deps are exact-pinned", () => {
    const fx = makeFixture({});
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "mastra", "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: {
          "@copilotkit/react-core": "1.59.2",
          "@copilotkit/runtime": "1.59.2",
          "@mastra/core": "0.15.0",
        },
      }),
    );
    const report = validateAll();
    expect(report.fail).toEqual([]);
    expect(report.ok.some((l) => l.includes("[OK] mastra"))).toBe(true);
  });

  it("FAILs when @copilotkit/* dep does not match canonical version", () => {
    const fx = makeFixture({});
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "mastra", "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: {
          "@copilotkit/react-core": "1.58.0",
          "@mastra/core": "0.15.0",
        },
      }),
    );
    const report = validateAll();
    expect(
      report.fail.some(
        (l) =>
          l.includes("[FAIL] mastra:") &&
          l.includes("@copilotkit/react-core") &&
          l.includes("canonical is 1.59.2"),
      ),
    ).toBe(true);
  });

  it("FAILs when @copilotkit/* dep uses 'latest'", () => {
    const fx = makeFixture({});
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "mastra", "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: {
          "@copilotkit/runtime": "latest",
          "@mastra/core": "0.15.0",
        },
      }),
    );
    const report = validateAll();
    expect(
      report.fail.some(
        (l) =>
          l.includes("@copilotkit/runtime") &&
          l.includes("canonical is 1.59.2"),
      ),
    ).toBe(true);
  });

  it("passes when an override allows a non-canonical @copilotkit pin (e.g. pkg.pr.new URL)", () => {
    const url =
      "https://pkg.pr.new/CopilotKit/CopilotKit/@copilotkit/runtime@4482";
    const fx = makeFixture({
      overrides: {
        "built-in-agent": {
          "@copilotkit/runtime": url,
        },
      },
    });
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "built-in-agent", "package.json"),
      JSON.stringify({
        name: "built-in-agent",
        dependencies: {
          "@copilotkit/react-core": "1.59.2",
          "@copilotkit/runtime": url,
        },
      }),
    );
    const report = validateAll();
    expect(report.fail).toEqual([]);
    expect(report.ok.some((l) => l.includes("[OK] built-in-agent"))).toBe(true);
  });

  it("FAILs when an overridden @copilotkit/* dep does not match the override spec", () => {
    const url =
      "https://pkg.pr.new/CopilotKit/CopilotKit/@copilotkit/runtime@4482";
    const fx = makeFixture({
      overrides: {
        "built-in-agent": {
          "@copilotkit/runtime": url,
        },
      },
    });
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "built-in-agent", "package.json"),
      JSON.stringify({
        name: "built-in-agent",
        dependencies: {
          "@copilotkit/react-core": "1.59.2",
          "@copilotkit/runtime":
            "https://pkg.pr.new/CopilotKit/CopilotKit/@copilotkit/runtime@DIFFERENT",
        },
      }),
    );
    const report = validateAll();
    expect(
      report.fail.some(
        (l) =>
          l.includes("@copilotkit/runtime") && l.includes("override expects"),
      ),
    ).toBe(true);
  });

  it("supports a per-slug legacy-version override (ms-agent-harness-dotnet style)", () => {
    const fx = makeFixture({
      overrides: {
        "ms-agent-harness-dotnet": {
          "@copilotkit/react-core": "1.57.2",
          "@copilotkit/runtime": "1.57.2",
        },
      },
    });
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "ms-agent-harness-dotnet", "package.json"),
      JSON.stringify({
        name: "ms-agent-harness-dotnet",
        dependencies: {
          "@copilotkit/react-core": "1.57.2",
          "@copilotkit/runtime": "1.57.2",
        },
      }),
    );
    const report = validateAll();
    expect(report.fail).toEqual([]);
  });

  it("FAILs when a framework dep is not an exact pin (^1.0.0)", () => {
    const fx = makeFixture({});
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "mastra", "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: {
          "@copilotkit/react-core": "1.59.2",
          "@mastra/core": "^1.0.0",
        },
      }),
    );
    const report = validateAll();
    expect(
      report.fail.some(
        (l) => l.includes("@mastra/core") && l.includes("is not an exact pin"),
      ),
    ).toBe(true);
  });

  it("FAILs when a framework dep uses 'next' dist-tag", () => {
    const fx = makeFixture({});
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "mastra", "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: {
          "@copilotkit/react-core": "1.59.2",
          "@mastra/core": "next",
        },
      }),
    );
    const report = validateAll();
    expect(
      report.fail.some(
        (l) => l.includes("@mastra/core") && /not an exact pin/.test(l),
      ),
    ).toBe(true);
  });

  it("skips workspace: refs instead of failing", () => {
    const fx = makeFixture({});
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "mastra", "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: {
          "@copilotkit/react-core": "1.59.2",
          "@mastra/core": "workspace:*",
        },
      }),
    );
    const report = validateAll();
    expect(report.fail).toEqual([]);
    expect(report.skip.some((l) => l.includes("@mastra/core"))).toBe(true);
  });

  it("ignores non-framework deps (e.g. react, lodash)", () => {
    const fx = makeFixture({});
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    write(
      path.join(fx.pkgsDir, "mastra", "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: {
          "@copilotkit/react-core": "1.59.2",
          "@mastra/core": "0.15.0",
          // Non-framework deps are unconstrained.
          react: "^18.2.0",
          lodash: "latest",
        },
      }),
    );
    const report = validateAll();
    expect(report.fail).toEqual([]);
  });

  it("does NOT depend on examples/integrations — passes with the dir entirely absent", () => {
    const fx = makeFixture({});
    repoRoot = fx.repoRoot;
    process.env.VALIDATE_PINS_REPO_ROOT = fx.repoRoot;
    // Notably: do NOT create examples/integrations.
    write(
      path.join(fx.pkgsDir, "mastra", "package.json"),
      JSON.stringify({
        name: "mastra",
        dependencies: { "@copilotkit/react-core": "1.59.2" },
      }),
    );
    const report = validateAll();
    expect(report.fail).toEqual([]);
  });
});
