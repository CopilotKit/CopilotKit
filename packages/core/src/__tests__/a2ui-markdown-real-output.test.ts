import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractFenceOperations,
  prepareSurfaceOperations,
  splitA2UIMarkdown,
  type A2UIOperation,
} from "../a2ui-markdown";

// Real gpt-5.4 responses (BuiltInAgent: bi1, bi2; LangGraph: lg1, lg2).
// bi1: one updateComponents line with a stray quote before "]}}".
// bi2, lg1: updateComponents pretty-printed over many lines.
// lg2: updateDataModel line missing its final closing brace.
const FIXTURES = ["bi1", "bi2", "lg1", "lg2"] as const;

function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, "fixtures", "a2ui-markdown", `${name}.txt`),
    "utf8",
  );
}

function prepare(fenceText: string): A2UIOperation[] {
  const { operations } = extractFenceOperations(fenceText);
  return prepareSurfaceOperations({
    operations,
    fallbackSurfaceId: "f",
    catalogId: "cat",
  }).operations;
}

function componentsOf(ops: A2UIOperation[]): Record<string, unknown>[] {
  return ops.flatMap((op) => {
    const inner = op.updateComponents as
      | { components?: Record<string, unknown>[] }
      | undefined;
    return inner?.components ?? [];
  });
}

function firstFence(markdown: string): string | undefined {
  const fence = splitA2UIMarkdown(markdown).find((s) => s.type === "a2ui");
  return fence?.type === "a2ui" ? fence.text : undefined;
}

describe.each(FIXTURES)("real model output %s", (name) => {
  const markdown = loadFixture(name);

  it("has a closed a2ui fence", () => {
    const fences = splitA2UIMarkdown(markdown).filter(
      (s) => s.type === "a2ui" && s.closed,
    );
    expect(fences.length).toBeGreaterThanOrEqual(1);
  });

  it("yields a root and the full component tree", () => {
    const components = componentsOf(prepare(firstFence(markdown)!));
    expect(components.some((c) => c.id === "root")).toBe(true);
    expect(components.length).toBeGreaterThanOrEqual(15);
  });
});

describe("real model output lg2 data model", () => {
  it("recovers the updateDataModel despite the missing closing brace", () => {
    const data = prepare(firstFence(loadFixture("lg2"))!).find(
      (op) => op.updateDataModel,
    )?.updateDataModel as { value?: Record<string, unknown> } | undefined;
    expect(data?.value).toHaveProperty("estimator");
  });
});

describe("real model output bi2 streaming (pretty-printed)", () => {
  // The root component is the first item of bi2's pretty-printed components
  // array: a root is first available at the 10% prefix (3 components).
  it("never throws and paints a root well before the end", () => {
    const markdown = loadFixture("bi2");
    const rootAt: number[] = [];
    for (let step = 1; step <= 20; step++) {
      const prefix = markdown.slice(
        0,
        Math.floor((markdown.length * step) / 20),
      );
      const fenceText = firstFence(prefix);
      if (fenceText === undefined) continue;
      const components = componentsOf(prepare(fenceText));
      if (components.some((c) => c.id === "root")) rootAt.push(step * 5);
    }
    expect(rootAt.length).toBeGreaterThan(0);
    expect(rootAt[0]).toBeLessThanOrEqual(15);
  });
});
