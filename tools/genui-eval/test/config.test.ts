import { describe, expect, it } from "vitest";
import { caseContext, loadCases, parseCases, selectCases } from "../src/cases";
import { defineEvalConfig, resolvePlan } from "../src/config";
import config from "../eval.config";

const base = {
  models: [
    { id: "a", model: "fake:offline" },
    { id: "b", model: "openai/gpt-5-mini" },
  ],
  presets: { p: { models: ["a"], cases: "all" as const, samples: 1 } },
  transports: ["markdown" as const],
  budgetUsd: 1,
  judge: { model: "fake:judge" },
  reflection: { model: "fake:reflect" },
};

describe("config", () => {
  it("accepts the checked-in config", () => {
    expect(Object.keys(config.presets)).toEqual(
      expect.arrayContaining(["smoke", "full", "small", "offline"]),
    );
  });

  it("rejects a preset that names an unknown model", () => {
    expect(() =>
      defineEvalConfig({
        ...base,
        presets: { p: { models: ["nope"], cases: "all", samples: 1 } },
      }),
    ).toThrow('preset "p" names unknown model "nope"');
  });

  it("rejects a reflection model that is the judge", () => {
    expect(() =>
      defineEvalConfig({ ...base, reflection: { model: "fake:judge" } }),
    ).toThrow("the reflection model must differ from the judge");
  });

  it("resolves a preset with overrides, and refuses a judge under test", () => {
    const c = defineEvalConfig(base);
    const plan = resolvePlan(c, "p", { samples: 3 });
    expect(plan.models.map((m) => m.id)).toEqual(["a"]);
    expect(plan.samples).toBe(3);
    expect(plan.judge).toBe("fake:judge");
    const judged = defineEvalConfig({
      ...base,
      judge: { model: "openai/gpt-5-mini" },
    });
    expect(() => resolvePlan(judged, "p", { models: ["b"] })).toThrow(
      "is also a model under test",
    );
    expect(() => resolvePlan(c, "missing")).toThrow('Unknown preset "missing"');
  });
});

describe("cases", () => {
  it("loads 30 training and 10 held-out cases with unique ids and tags", () => {
    const train = loadCases("train");
    const heldout = loadCases("heldout");
    expect(train).toHaveLength(30);
    expect(heldout).toHaveLength(10);
    const ids = [...train, ...heldout].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...train, ...heldout].every((c) => c.tags.length > 0)).toBe(true);
    expect(heldout.some((c) => !c.expect.ui)).toBe(true);
  });

  it("selects cases by tag", () => {
    const train = loadCases("train");
    const smoke = selectCases(train, "tag:smoke");
    expect(smoke.length).toBeGreaterThan(0);
    expect(smoke.every((c) => c.tags.includes("smoke"))).toBe(true);
  });

  it("names the line of a bad case", () => {
    expect(() => parseCases('{"id":"x"}\n', "bad.jsonl")).toThrow(
      "bad.jsonl:1:",
    );
  });

  it("reads a case's app context and sends an object value as JSON", () => {
    const [c] = parseCases(
      '{"id":"x","message":"m","catalog":"standard","tags":["t"],"expect":{"ui":true},"context":[{"description":"Plans","value":{"team":29}},{"description":"Note","value":"plain"}]}\n',
    );
    expect(caseContext(c)).toEqual([
      { description: "Plans", value: '{"team":29}' },
      { description: "Note", value: "plain" },
    ]);
  });
});
