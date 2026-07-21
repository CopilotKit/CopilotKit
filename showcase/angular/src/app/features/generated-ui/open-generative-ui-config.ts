import type {
  OpenGenerativeUIConfig,
  SandboxFunction,
} from "@copilotkit/angular";
import { z } from "zod";

const VISUALIZATION_DESIGN_SKILL = `Create focused educational visualizations.
Use semantic HTML, concise labels, high-contrast colors, responsive layout, and
accessible text alternatives. Prefer diagrams and interactive explanations over
decorative chrome. Keep generated controls keyboard operable.`;

const expressionParameters = z.object({ expression: z.string() });
const notificationParameters = z.object({ message: z.string().max(280) });

const sandboxFunctions: readonly SandboxFunction[] = [
  {
    name: "evaluateExpression",
    description:
      "Evaluate basic arithmetic with numbers, parentheses, +, -, *, and /.",
    parameters: expressionParameters,
    handler: async (args) => {
      try {
        const { expression } = expressionParameters.parse(args);
        return { ok: true, value: evaluateArithmeticExpression(expression) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Invalid expression.",
        };
      }
    },
  },
  {
    name: "notifyHost",
    description:
      "Send a short status notification from generated UI to its host.",
    parameters: notificationParameters,
    handler: async (args) => {
      const { message } = notificationParameters.parse(args);
      return { ok: true, message };
    },
  },
];

/** Enable the appropriate built-in renderer and sandbox bridge by route. */
export function openGenerativeUIConfigForFeature(
  feature: string,
): OpenGenerativeUIConfig | undefined {
  switch (feature) {
    case "open-gen-ui":
      return { designSkill: VISUALIZATION_DESIGN_SKILL };
    case "open-gen-ui-advanced":
      return { sandboxFunctions: [...sandboxFunctions] };
    default:
      return undefined;
  }
}

/** Parse a deliberately small arithmetic grammar without evaluating code. */
export function evaluateArithmeticExpression(expression: string): number {
  let cursor = 0;

  const skipWhitespace = (): void => {
    while (/\s/.test(expression[cursor] ?? "")) cursor += 1;
  };

  const parseNumber = (): number => {
    skipWhitespace();
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(expression.slice(cursor));
    if (!match) throw new Error("Expected a number.");
    cursor += match[0].length;
    return Number(match[0]);
  };

  const parseFactor = (): number => {
    skipWhitespace();
    const token = expression[cursor];
    if (token === "+" || token === "-") {
      cursor += 1;
      const value = parseFactor();
      return token === "-" ? -value : value;
    }
    if (token !== "(") return parseNumber();
    cursor += 1;
    const value = parseExpression();
    skipWhitespace();
    if (expression[cursor] !== ")") throw new Error("Expected ')'.");
    cursor += 1;
    return value;
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    for (;;) {
      skipWhitespace();
      const operator = expression[cursor];
      if (operator !== "*" && operator !== "/") return value;
      cursor += 1;
      const operand = parseFactor();
      value = operator === "*" ? value * operand : value / operand;
      if (!Number.isFinite(value)) throw new Error("Result is not finite.");
    }
  };

  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      skipWhitespace();
      const operator = expression[cursor];
      if (operator !== "+" && operator !== "-") return value;
      cursor += 1;
      const operand = parseTerm();
      value = operator === "+" ? value + operand : value - operand;
    }
  }

  if (!expression.trim()) throw new Error("Expression is empty.");
  const result = parseExpression();
  skipWhitespace();
  if (cursor !== expression.length) throw new Error("Unsupported characters.");
  if (!Number.isFinite(result)) throw new Error("Result is not finite.");
  return result;
}
