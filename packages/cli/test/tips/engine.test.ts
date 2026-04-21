// packages/cli/test/tips/engine.test.ts
import { describe, test, expect } from "@jest/globals";
import { createTipEngine } from "../../src/tips/engine.js";
import { InMemoryTipStore } from "../../src/tips/stores/in-memory.js";
import { SequentialStrategy } from "../../src/tips/strategies/sequential.js";
import { MarkdownTipRenderer } from "../../src/tips/renderers/markdown.js";
import type { Tip, TipStrategy } from "../../src/tips/types.js";

const tips: Tip[] = [
  { id: "a", message: "Tip A" },
  { id: "b", message: "Tip B" },
];

describe("TipEngine", () => {
  test("show() renders a tip and updates store", async () => {
    const store = new InMemoryTipStore();
    const engine = createTipEngine({
      tips,
      strategy: new SequentialStrategy(),
      renderer: new MarkdownTipRenderer(),
      store,
    });

    const lines: string[] = [];
    await engine.show((msg) => lines.push(msg));

    // Should have rendered something
    const output = lines.join("\n");
    expect(output).toContain("Tip A");

    // Store should be updated
    const state = await store.load();
    expect(state.shownTipIds).toEqual(["a"]);
    expect(state.lastShownAt).toBeDefined();
  });

  test("show() advances sequentially on repeated calls", async () => {
    const store = new InMemoryTipStore();
    const engine = createTipEngine({
      tips,
      strategy: new SequentialStrategy(),
      renderer: new MarkdownTipRenderer(),
      store,
    });

    const lines1: string[] = [];
    await engine.show((msg) => lines1.push(msg));
    expect(lines1.join("\n")).toContain("Tip A");

    const lines2: string[] = [];
    await engine.show((msg) => lines2.push(msg));
    expect(lines2.join("\n")).toContain("Tip B");
  });

  test("show() does nothing when strategy returns null", async () => {
    const nullStrategy: TipStrategy = {
      select: () => null,
    };
    const store = new InMemoryTipStore();
    const engine = createTipEngine({
      tips,
      strategy: nullStrategy,
      renderer: new MarkdownTipRenderer(),
      store,
    });

    const lines: string[] = [];
    await engine.show((msg) => lines.push(msg));

    expect(lines).toEqual([]);
    const state = await store.load();
    expect(state.shownTipIds).toEqual([]);
  });

  test("show() with empty tips array does nothing", async () => {
    const store = new InMemoryTipStore();
    const engine = createTipEngine({
      tips: [],
      strategy: new SequentialStrategy(),
      renderer: new MarkdownTipRenderer(),
      store,
    });

    const lines: string[] = [];
    await engine.show((msg) => lines.push(msg));
    expect(lines).toEqual([]);
  });
});
