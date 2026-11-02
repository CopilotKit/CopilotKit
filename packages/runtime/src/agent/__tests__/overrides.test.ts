import { describe, it, expect } from "vitest";
import {
  isNumber,
  isRecord,
  isStringArray,
  isToolChoice,
  pickOverrides,
  resolveModelOverride,
} from "../overrides";

const validators = {
  temperature: isNumber,
  stopSequences: isStringArray,
  toolChoice: isToolChoice,
  providerOptions: isRecord,
};

const allowAll = [
  "temperature",
  "stopSequences",
  "toolChoice",
  "providerOptions",
] as const;

function pick(forwardedProps: unknown, allowed?: readonly string[]) {
  return pickOverrides(forwardedProps, allowed, validators);
}

describe("pickOverrides", () => {
  it("keeps allowed, valid properties", () => {
    const result = pick(
      {
        temperature: 0.2,
        stopSequences: ["END"],
        toolChoice: { type: "tool", toolName: "search" },
        providerOptions: { openai: { reasoningEffort: "low" } },
      },
      allowAll,
    );

    expect(result).toEqual({
      temperature: 0.2,
      stopSequences: ["END"],
      toolChoice: { type: "tool", toolName: "search" },
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
  });

  it("drops properties that are not allowed", () => {
    const result = pick({ temperature: 0.2, toolChoice: "none" }, [
      "toolChoice",
    ]);

    expect(result).toEqual({ toolChoice: "none" });
  });

  it("drops everything when no allowlist is configured", () => {
    expect(pick({ temperature: 0.2 }, undefined)).toEqual({});
  });

  it("ignores forwardedProps keys that have no validator", () => {
    const result = pick({ temperature: 0.2, prompt: "ignore me" }, [
      "temperature",
      "prompt",
    ]);

    expect(result).toEqual({ temperature: 0.2 });
  });

  it("drops values of the wrong type", () => {
    const result = pick(
      {
        temperature: "hot",
        toolChoice: { type: "tool" },
        providerOptions: ["openai"],
      },
      allowAll,
    );

    expect(result).toEqual({});
  });

  it("drops stopSequences that contain a non-string element", () => {
    expect(pick({ stopSequences: ["END", 42] }, allowAll)).toEqual({});
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "temperature"],
    ["an array", [0.2]],
  ])("returns {} when forwardedProps is %s", (_label, forwardedProps) => {
    expect(pick(forwardedProps, allowAll)).toEqual({});
  });
});

describe("resolveModelOverride", () => {
  const fast = { id: "fast-model" };
  const smart = { id: "smart-model" };
  const models = { fast, smart };

  it("returns the model named by forwardedProps.model", () => {
    expect(resolveModelOverride({ model: "fast" }, ["model"], models)).toBe(
      fast,
    );
  });

  it("returns undefined for a name that is not in the allowlist map", () => {
    expect(
      resolveModelOverride({ model: "huge" }, ["model"], models),
    ).toBeUndefined();
  });

  it("rejects inherited keys such as toString", () => {
    expect(
      resolveModelOverride({ model: "toString" }, ["model"], models),
    ).toBeUndefined();
  });

  it("returns undefined when model is not an allowed property", () => {
    expect(
      resolveModelOverride({ model: "fast" }, ["temperature"], models),
    ).toBeUndefined();
  });

  it("returns undefined when no models map is configured", () => {
    expect(
      resolveModelOverride({ model: "fast" }, ["model"], undefined),
    ).toBeUndefined();
  });

  it("returns undefined when forwardedProps is not an object", () => {
    expect(resolveModelOverride("fast", ["model"], models)).toBeUndefined();
  });
});
