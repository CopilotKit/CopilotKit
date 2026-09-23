import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import {
  frameworkGateMatches,
  frameworkGateProblems,
  parseFrameworkGate,
} from "../framework-gate";
import { getIntegration } from "../registry";
import { filterFrameworkScopedBlocks } from "../toc";

const CONTENT_DIR = path.join(process.cwd(), "src/content");

function mdxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(full);
    return entry.name.endsWith(".mdx") ? [full] : [];
  });
}

describe("WhenFrameworkHas gates", () => {
  test("every gate in the docs content is well-formed", () => {
    const problems = mdxFiles(CONTENT_DIR).flatMap((file) =>
      [
        ...fs
          .readFileSync(file, "utf8")
          .matchAll(/<WhenFrameworkHas\b([^>]*)>/g),
      ].flatMap(([tag, attrs]) =>
        frameworkGateProblems(parseFrameworkGate(attrs)).map(
          (problem) =>
            `${path.relative(CONTENT_DIR, file)}: ${tag.replace(/\s+/g, " ")}: ${problem}`,
        ),
      ),
    );
    expect(problems).toEqual([]);
  });

  test("slug gates match one framework, and noneOf is the fallback", () => {
    const lgp = getIntegration("langgraph-python");
    const fastapi = getIntegration("langgraph-fastapi");
    const own = { flag: "slug", equals: "langgraph-python" };
    const fallback = {
      flag: "slug",
      noneOf: "langgraph-python google-adk",
    };
    expect(frameworkGateMatches(lgp, own)).toBe(true);
    expect(frameworkGateMatches(fastapi, own)).toBe(false);
    expect(frameworkGateMatches(lgp, fallback)).toBe(false);
    expect(frameworkGateMatches(fastapi, fallback)).toBe(true);
    expect(frameworkGateMatches(undefined, fallback)).toBe(false);
  });

  test("malformed gates are reported and render nothing", () => {
    const lgp = getIntegration("langgraph-python");
    for (const gate of [
      { flag: "slug", absent: true },
      { flag: "not_a_flag", equals: "x" },
      { flag: "slug", equals: "langgraph-python", noneOf: "google-adk" },
      { flag: "slug" },
    ]) {
      expect(frameworkGateProblems(gate)).not.toEqual([]);
      expect(frameworkGateMatches(lgp, gate)).toBe(false);
    }
  });
});

describe("shared-state guide: publishing UI-owned state", () => {
  const source = loadDoc("shared-state")?.source ?? "";
  const section = (framework: string) => {
    const body = filterFrameworkScopedBlocks(source, framework);
    return body.slice(
      body.indexOf("## Publishing UI-owned state"),
      body.indexOf("## Read-only context"),
    );
  };

  test.each([
    ["langgraph-python", 'region="shared-state-read-agent"'],
    ["google-adk", 'region="shared-state-read-agent"'],
    ["strands", 'region="shared-state-recipe-prompt"'],
  ])(
    "%s sources the code that reads the recipe and ends with the test step",
    (framework, reader) => {
      const text = section(framework);
      expect(text).toContain(reader);
      expect(text).toContain("To test it, edit a field in the form");
      expect(text).not.toContain("Publishing the value is only half");
    },
  );

  test("langgraph-typescript says the demo does not read the recipe yet", () => {
    const text = section("langgraph-typescript");
    expect(text).toContain("doesn't read `recipe` yet");
    expect(text).not.toContain("To test it");
  });

  test.each([
    "langgraph-fastapi",
    "claude-sdk-python",
    "claude-sdk-typescript",
  ])("%s gets the fallback, with no dangling test step", (framework) => {
    const text = section(framework);
    expect(text).toContain("Publishing the value is only half");
    expect(text).not.toContain("To test it");
    expect(text).not.toContain("<Snippet");
  });
});
