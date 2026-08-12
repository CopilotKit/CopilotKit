import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadManifest,
  summarizeResults,
  typecheckScenario,
  validateManifestContracts,
} from "./evaluator";
import type { EvaluationResult, SkillEvaluationScenario } from "./evaluator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = loadManifest(root);

function scenarioWithSource(source: string): SkillEvaluationScenario {
  return {
    id: "test-scenario",
    skill: "copilotkit-setup",
    sources: [{ path: "fixture.ts", source }],
    requiredEntrypoints: [],
  };
}

describe("public skill evaluator", () => {
  it("accepts current setup package entrypoints and APIs", () => {
    const scenario: SkillEvaluationScenario = {
      id: "current-setup-assets",
      skill: "copilotkit-setup",
      sources: [
        "skills/copilotkit-setup/assets/nextjs-app-router-route.ts",
        "skills/copilotkit-setup/assets/nextjs-app-router-page.tsx",
        "skills/copilotkit-setup/assets/express-runtime.ts",
      ].map((path) => ({
        path,
        source: readFileSync(resolve(root, path), "utf8"),
      })),
      requiredEntrypoints: ["@copilotkit/react-core/v2/styles.css"],
    };

    expect(validateManifestContracts(manifest, scenario)).toEqual([]);
  });

  it("rejects a package that is absent from the public API manifest", () => {
    const diagnostics = validateManifestContracts(
      manifest,
      scenarioWithSource('import { CopilotKit } from "@copilotkit/react";'),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "unknown-package",
        message: expect.stringContaining(
          '"@copilotkit/react" is not a package in manifest.v1.json',
        ),
      }),
    ]);
  });

  it("rejects deprecated factories with the manifest replacement", () => {
    const diagnostics = validateManifestContracts(
      manifest,
      scenarioWithSource(
        'import { createCopilotEndpoint } from "@copilotkit/runtime/v2/hono";',
      ),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "deprecated-api",
        message: expect.stringContaining(
          'replace with createCopilotHonoHandler from "@copilotkit/runtime/v2/hono"',
        ),
      }),
    ]);
  });

  it("rejects required entrypoints that are not publicly exported", () => {
    const diagnostics = validateManifestContracts(manifest, {
      ...scenarioWithSource(
        'import { CopilotKit } from "@copilotkit/react-core/v2";',
      ),
      requiredEntrypoints: ["@copilotkit/react-core/styles.css"],
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "unknown-entrypoint",
        message: expect.stringContaining(
          '"@copilotkit/react-core/styles.css" is not exported',
        ),
      }),
    ]);
  });

  it("reports TypeScript failures from the built package declarations", () => {
    const diagnostics = typecheckScenario(
      root,
      scenarioWithSource(
        'import { NotARealCopilotKitExport } from "@copilotkit/runtime/v2";',
      ),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "typescript",
        message: expect.stringContaining("TS2305: Module"),
      }),
    ]);
    expect(diagnostics[0].message).toContain("NotARealCopilotKitExport");
  });

  it("reports pass rate, median attempts, and median time to green", () => {
    const results: EvaluationResult[] = [
      {
        id: "one",
        skill: "copilotkit-setup",
        passed: true,
        attempts: 1,
        durationMs: 30,
        diagnostics: [],
      },
      {
        id: "two",
        skill: "copilotkit-setup",
        passed: true,
        attempts: 2,
        durationMs: 10,
        diagnostics: [],
      },
      {
        id: "three",
        skill: "copilotkit-setup",
        passed: false,
        attempts: 3,
        durationMs: 50,
        diagnostics: [],
      },
    ];

    expect(summarizeResults(results)).toEqual({
      total: 3,
      passed: 2,
      passRate: 2 / 3,
      medianAttempts: 2,
      medianTimeToGreenMs: 20,
    });
  });
});
