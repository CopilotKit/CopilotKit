import { describe, it, expect } from "vitest";
import {
  findOverlaps,
  type Fixture,
  type Allowlist,
} from "../validate-fixture-overlap";

const noise = [
  "hi",
  "hello",
  "help",
  "the",
  "say",
  "ok",
  "okay",
  "please",
  "thanks",
  "architecture",
  "chat",
  "test",
  "yes",
  "no",
];

describe("findOverlaps", () => {
  it("flags an inner-substring pair", () => {
    const fixtures: Fixture[] = [
      { source: "a.json", index: 0, userMessage: "weather" },
      {
        source: "a.json",
        index: 1,
        userMessage: "what is the weather in tokyo",
      },
    ];
    const overlaps = findOverlaps(fixtures, [], noise);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({
      inner: "weather",
      outer: "what is the weather in tokyo",
    });
  });

  it("ignores allowlisted pairs", () => {
    const fixtures: Fixture[] = [
      { source: "a.json", index: 0, userMessage: "report" },
      { source: "a.json", index: 1, userMessage: "write a concise report" },
    ];
    const allow: Allowlist = [
      { inner: "report", outer: "write a concise report", reason: "test" },
    ];
    expect(findOverlaps(fixtures, allow, noise)).toHaveLength(0);
  });

  it("flags a fixture whose userMessage is itself a noise token", () => {
    const fixtures: Fixture[] = [
      { source: "a.json", index: 0, userMessage: "hi" },
    ];
    const overlaps = findOverlaps(fixtures, [], noise);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].kind).toBe("noise");
  });

  it("passes on a substring-disjoint set", () => {
    const fixtures: Fixture[] = [
      {
        source: "a.json",
        index: 0,
        userMessage:
          "if a clock loses 12 minutes a day how far behind after a week",
      },
      {
        source: "a.json",
        index: 1,
        userMessage: "block out my tuesday with three meetings and a gym slot",
      },
    ];
    expect(findOverlaps(fixtures, [], noise)).toHaveLength(0);
  });

  it("treats userMessage matching case-insensitively", () => {
    const fixtures: Fixture[] = [
      { source: "a.json", index: 0, userMessage: "Tokyo" },
      { source: "a.json", index: 1, userMessage: "weather in tokyo" },
    ];
    expect(findOverlaps(fixtures, [], noise)).toHaveLength(1);
  });
});
