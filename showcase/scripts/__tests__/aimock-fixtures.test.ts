import { describe, it, expect } from "vitest";
import path from "path";
import { readdirSync } from "fs";
import { globSync } from "glob";
import {
  type ValidationResult,
  loadFixtureFile,
  validateFixtures,
} from "@copilotkit/aimock";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AIMOCK_DIR = path.join(REPO_ROOT, "showcase", "aimock");

const fixtureFiles: string[] = [
  ...readdirSync(AIMOCK_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(AIMOCK_DIR, f)),
  ...globSync("examples/integrations/*/fixtures/*.json", {
    cwd: REPO_ROOT,
    absolute: true,
  }),
  ...globSync("scripts/doc-tests/fixtures/*.json", {
    cwd: REPO_ROOT,
    absolute: true,
  }),
];

describe("aimock fixtures across repo", () => {
  it("discovers at least one fixture file", () => {
    expect(
      fixtureFiles.length,
      "fixture discovery returned 0 files — misconfigured glob or missing fixtures",
    ).toBeGreaterThan(0);
  });

  for (const filePath of fixtureFiles) {
    const relative = path.relative(REPO_ROOT, filePath);
    it(`${relative} loads and validates with zero errors`, () => {
      const fixtures = loadFixtureFile(filePath);

      // If loadFixtureFile returns [], the file itself is broken (unreadable,
      // invalid JSON, or missing "fixtures" array). Treat as fatal.
      expect(
        fixtures.length,
        `${relative} produced 0 fixtures — file is unreadable or malformed`,
      ).toBeGreaterThan(0);

      const results = validateFixtures(fixtures);
      const errors = results.filter(
        (r: ValidationResult) => r.severity === "error",
      );

      if (errors.length > 0) {
        const detail = errors
          .map((e: ValidationResult) => `  [${e.fixtureIndex}] ${e.message}`)
          .join("\n");
        throw new Error(
          `${relative} has ${errors.length} fixture validation error(s):\n${detail}`,
        );
      }

      expect(errors).toEqual([]);
    });
  }
});
