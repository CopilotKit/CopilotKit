import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  evaluateRawBudget,
  initialOutputNames,
} from "./check-performance-budget.mjs";

const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Angular Showcase performance budget", () => {
  it("walks static imports and excludes dynamically loaded feature chunks", () => {
    expect(
      initialOutputNames({
        "main.js": {
          entryPoint: "src/main.ts",
          imports: [
            { path: "shared.js", kind: "import-statement" },
            { path: "feature.js", kind: "dynamic-import" },
          ],
        },
        "styles.css": {
          entryPoint: "angular:styles/global:styles",
          imports: [],
        },
        "shared.js": { imports: [] },
        "feature.js": { imports: [] },
      }),
    ).toEqual(["main.js", "shared.js", "styles.css"]);
  });

  it("uses the lower of the ten-percent relative threshold and absolute cap", () => {
    const baseline = {
      initial: { rawBytes: 2_781_308 },
      maximumRelativeRegression: 0.1,
      absoluteCapBytes: 3_000_000,
    };

    expect(evaluateRawBudget(3_000_000, baseline)).toMatchObject({
      passes: true,
      effectiveCap: 3_000_000,
    });
    expect(evaluateRawBudget(3_000_001, baseline)).toMatchObject({
      passes: false,
      effectiveCap: 3_000_000,
    });
  });

  it("locks Angular CLI and packed-artifact budgets to the measured baseline", () => {
    const baseline = JSON.parse(
      readFileSync(join(projectDirectory, "performance-baseline.json"), "utf8"),
    );
    const angular = JSON.parse(
      readFileSync(join(projectDirectory, "angular.json"), "utf8"),
    );
    const budgets =
      angular.projects["showcase-angular"].architect.build.configurations
        .production.budgets;

    expect(baseline).toMatchObject({
      schemaVersion: 1,
      sourceRevision: "checkpoint-3-shared-build",
      command: "pnpm --dir showcase/angular build",
      initial: {
        rawBytes: expect.any(Number),
        gzipBytes: expect.any(Number),
        brotliBytes: expect.any(Number),
      },
      maximumRelativeRegression: 0.1,
      absoluteCapBytes: 4_600_000,
    });
    expect(budgets).toContainEqual({
      type: "initial",
      maximumWarning: "4400000b",
      maximumError: "4600000b",
    });
  });

  it("records ten passing runtime samples for both proof integrations", () => {
    const baseline = JSON.parse(
      readFileSync(join(projectDirectory, "performance-baseline.json"), "utf8"),
    ) as {
      runtimeReadiness: {
        maximumReadyMs: number;
        integrations: Record<
          string,
          {
            sourceCommit: string;
            containerImageRevision: string;
            fixtureRevision: string;
            sampleCount: number;
            measurementsMs: number[];
            passed: boolean;
          }
        >;
      };
    };

    expect(Object.keys(baseline.runtimeReadiness.integrations).sort()).toEqual([
      "langgraph-python",
      "mastra",
    ]);
    for (const evidence of Object.values(
      baseline.runtimeReadiness.integrations,
    )) {
      expect(evidence.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(evidence.containerImageRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(evidence.fixtureRevision).toMatch(/^[a-f0-9]{40}$/);
      expect(evidence.sampleCount).toBe(10);
      expect(evidence.measurementsMs).toHaveLength(10);
      expect(
        evidence.measurementsMs.every(
          (measurement) =>
            measurement <= baseline.runtimeReadiness.maximumReadyMs,
        ),
      ).toBe(true);
      expect(evidence.passed).toBe(true);
    }
  });

  it("uses the existing integration staging path instead of a dedicated image", () => {
    const staging = readFileSync(
      join(projectDirectory, "../scripts/cli/_common.sh"),
      "utf8",
    );

    expect(staging).toContain('pnpm --dir "$SHOWCASE_ROOT/angular" build');
    expect(staging).toContain('cp -R "$angular_source/." "$angular_link/"');
  });
});
