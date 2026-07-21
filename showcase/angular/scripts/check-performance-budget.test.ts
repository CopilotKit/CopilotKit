import { describe, expect, it } from "vitest";

import {
  evaluateRawBudget,
  initialOutputNames,
} from "./check-performance-budget.mjs";

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
});
