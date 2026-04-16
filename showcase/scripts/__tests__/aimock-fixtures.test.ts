import { describe, it, expect } from "vitest";
import path from "path";
import { loadFixtureFile, validateFixtures } from "@copilotkit/aimock";

const AIMOCK_DIR = path.resolve(__dirname, "..", "..", "aimock");

const FIXTURE_FILES = ["feature-parity.json", "smoke.json"];

describe("showcase aimock fixtures", () => {
  for (const file of FIXTURE_FILES) {
    it(`${file} loads and validates with zero errors`, () => {
      const filePath = path.join(AIMOCK_DIR, file);
      const fixtures = loadFixtureFile(filePath);

      // If loadFixtureFile returns [], the file itself is broken (unreadable,
      // invalid JSON, or missing "fixtures" array). Treat as fatal.
      expect(
        fixtures.length,
        `${file} produced 0 fixtures — file is unreadable or malformed`,
      ).toBeGreaterThan(0);

      const results = validateFixtures(fixtures);
      const errors = results.filter((r) => r.severity === "error");

      if (errors.length > 0) {
        const detail = errors
          .map((e) => `  [${e.fixtureIndex}] ${e.message}`)
          .join("\n");
        throw new Error(
          `${file} has ${errors.length} fixture validation error(s):\n${detail}`,
        );
      }

      expect(errors).toEqual([]);
    });
  }
});
