import { describe, expect, it } from "vitest";

import {
  evaluateArithmeticExpression,
  openGenerativeUIConfigForFeature,
} from "./open-generative-ui-config";

describe("openGenerativeUIConfigForFeature", () => {
  it("enables visual authoring only for the basic route", () => {
    const config = openGenerativeUIConfigForFeature("open-gen-ui");

    expect(config?.designSkill).toContain("educational visualizations");
    expect(config?.sandboxFunctions).toBeUndefined();
  });

  it("exposes the bounded host bridge only for the advanced route", () => {
    const config = openGenerativeUIConfigForFeature("open-gen-ui-advanced");

    expect(config?.sandboxFunctions?.map(({ name }) => name)).toEqual([
      "evaluateExpression",
      "notifyHost",
    ]);
    expect(openGenerativeUIConfigForFeature("agentic-chat")).toBeUndefined();
  });
});

describe("evaluateArithmeticExpression", () => {
  it("evaluates precedence and parentheses without executing JavaScript", () => {
    expect(evaluateArithmeticExpression("12 * (3 + 4.5)")).toBe(90);
  });

  it.each(["alert(1)", "1 / 0", "2 +", ""])(
    "rejects unsupported or invalid input %s",
    (expression) => {
      expect(() => evaluateArithmeticExpression(expression)).toThrow();
    },
  );
});
