import { schemaToJsonSchema } from "@copilotkit/shared";
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

  it("describes and validates the sandbox function arguments", async () => {
    const [evaluate, notify] =
      openGenerativeUIConfigForFeature("open-gen-ui-advanced")
        ?.sandboxFunctions ?? [];

    expect(schemaToJsonSchema(notify!.parameters)).toEqual({
      type: "object",
      properties: { message: { type: "string", maxLength: 280 } },
      required: ["message"],
    });
    await expect(evaluate!.handler({ expression: "2 * 3" })).resolves.toEqual({
      ok: true,
      value: 6,
    });
    await expect(evaluate!.handler({ expression: 6 })).resolves.toEqual({
      ok: false,
      error: 'Expected a string "expression".',
    });
    await expect(notify!.handler({ message: "x".repeat(281) })).rejects.toThrow(
      '"message" is longer than 280.',
    );
  });

  it("enables the standard sandbox for the Beautiful Chat composite", () => {
    expect(openGenerativeUIConfigForFeature("beautiful-chat")).toEqual({});
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
