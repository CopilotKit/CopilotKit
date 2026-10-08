import { compareCapture, coverageChecks } from "../row2/assertions.mjs";

export const row = {
  id: 2,
  title: "Fresh conversation → native framework storage",
  async run(context) {
    if (typeof context.services?.row2?.captureFresh !== "function")
      return {
        status: "blocked",
        checks: [],
        limitations: [
          "Fixture has no row2.captureFresh durable-store inspection service",
        ],
      };
    const captures = await context.services.row2.captureFresh({
      fixture: context.fixture,
    });
    if (!Array.isArray(captures) || !captures.length)
      throw new Error("Row2 requires fresh native captures");
    const checks = [];
    for (const [index, capture] of captures.entries()) {
      const artifact = `native-${index}.json`;
      await context.writeArtifact(artifact, capture);
      checks.push(
        ...compareCapture(capture).map((check) => ({
          ...check,
          evidence: [artifact],
        })),
      );
    }
    const coverage = coverageChecks(context.fixture.row2?.coverage, checks);
    await context.writeArtifact("native-comparisons.json", {
      checks,
      coverage,
      baseline: context.baseline,
    });
    const failed = checks.some((check) => check.status === "failed");
    return {
      status: failed
        ? "failed"
        : coverage.some((check) => check.status === "unvalidated")
          ? "unvalidated"
          : "passed",
      checks: [...checks, ...coverage],
      limitations: coverage
        .filter((check) => check.status !== "passed")
        .map((check) => `${check.name}: ${check.detail}`),
    };
  },
};
