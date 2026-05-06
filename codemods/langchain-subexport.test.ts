import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import jscodeshift from "jscodeshift";

import transformer from "./langchain-subexport.cjs";

const FIXTURES_DIR = path.resolve(__dirname, "__fixtures__");
const INPUT_DIR = path.join(FIXTURES_DIR, "input");
const OUTPUT_DIR = path.join(FIXTURES_DIR, "output");

function applyTransform(source: string, filename: string): string {
  const j = jscodeshift.withParser("tsx");
  const result = transformer({ source, path: filename }, {
    jscodeshift: j,
    j,
    stats: () => {},
    report: () => {},
  } as Parameters<typeof transformer>[1]);
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
});
