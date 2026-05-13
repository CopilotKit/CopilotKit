import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import jscodeshift from "jscodeshift";

import transformer from "./langchain-subexport.cjs";

const FIXTURES_DIR = path.resolve(__dirname, "__fixtures__");
const INPUT_DIR = path.join(FIXTURES_DIR, "input");
const OUTPUT_DIR = path.join(FIXTURES_DIR, "output");

function applyTransform(source: string, filename: string): string {
  const j = jscodeshift.withParser("tsx");
  const result = transformer(
    { source, path: filename },
    {
      jscodeshift: j,
      j,
      stats: () => {},
      report: () => {},
    },
  );
  return result === null || result === undefined ? source : result;
}

function loadFixturePair(name: string): { input: string; expected: string } {
  const input = readFileSync(path.join(INPUT_DIR, name), "utf8");
  const expected = readFileSync(path.join(OUTPUT_DIR, name), "utf8");
  return { input, expected };
}

describe("langchain-subexport codemod", () => {
  const fixtureFiles = readdirSync(INPUT_DIR).filter((f) =>
    /\.(ts|tsx|js|jsx)$/.test(f),
  );

  it("has at least one fixture", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtureFiles) {
    it(`transforms ${fixture} to match expected output`, () => {
      const { input, expected } = loadFixturePair(fixture);
      const actual = applyTransform(input, fixture);
      expect(actual.trim()).toBe(expected.trim());
    });

    it(`is idempotent on ${fixture}`, () => {
      const { input } = loadFixturePair(fixture);
      const once = applyTransform(input, fixture);
      const twice = applyTransform(once, fixture);
      expect(twice.trim()).toBe(once.trim());
    });
  }

  it("logs a warning when skipping a wildcard import", () => {
    const wildcardFixture = fixtureFiles.find((f) => f.includes("wildcard"));
    if (!wildcardFixture) {
      throw new Error("expected a wildcard fixture in __fixtures__/input/");
    }
    const { input } = loadFixturePair(wildcardFixture);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      applyTransform(input, wildcardFixture);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0][0];
      expect(message).toContain(wildcardFixture);
      expect(message).toContain("LangChainAdapter");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
