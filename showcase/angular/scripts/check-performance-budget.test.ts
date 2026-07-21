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
      baseCommit: "67959d863",
      command:
        "pack Angular workspace artifacts, then docker build -f showcase/angular/Dockerfile .",
      initial: {
        rawBytes: 4_202_530,
        gzipBytes: 1_674_006,
        brotliBytes: 1_407_857,
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
});
