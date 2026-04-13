/**
 * Calculator data layer for the UI Protocols Demo.
 * Simple expression evaluation and history tracking.
 */

export interface CalculatorState {
  id: string;
  display: string;
  expression: string;
  history: CalculatorEntry[];
  memory: number;
  createdAt: string;
}

export interface CalculatorEntry {
  expression: string;
  result: string;
  timestamp: string;
}

export interface CalculatorResult {
  success: boolean;
  message: string;
  state?: CalculatorState;
  result?: string;
}

// In-memory storage for calculator sessions
const calculators: Map<string, CalculatorState> = new Map();

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new calculator session.
 */
export function createCalculator(): CalculatorState {
  const id = generateId("calc");

  const state: CalculatorState = {
    id,
    display: "0",
    expression: "",
    history: [],
    memory: 0,
    createdAt: new Date().toISOString(),
  };

  calculators.set(id, state);
  return state;
}

/**
 * Get calculator state by ID.
 */
export function getCalculator(
  calculatorId: string,
): CalculatorState | undefined {
  return calculators.get(calculatorId);
}

/**
 * Safely evaluate a mathematical expression.
 * Only allows numbers and basic operators.
 */
function safeEvaluate(expression: string): number {
  // Remove any characters that aren't numbers, operators, or decimal points
  const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");

  if (!sanitized) {
    throw new Error("Invalid expression");
  }

  // Basic expression evaluation using Function (safer than eval for numbers only)
  try {
    // Replace % with /100 for percentage calculations
    const processed = sanitized.replace(/%/g, "/100");
    const result = new Function(`return (${processed})`)();

    if (typeof result !== "number" || !isFinite(result)) {
      throw new Error("Invalid result");
    }

    return result;
  } catch {
    throw new Error("Cannot evaluate expression");
  }
}

/**
 * Input a character or operation to the calculator.
 */
export function inputCalculator(
  calculatorId: string,
  input: string,
): CalculatorResult {
  const state = calculators.get(calculatorId);
  if (!state) {
    return { success: false, message: "Calculator not found" };
  }

  const operators = ["+", "-", "*", "/"];
  const lastChar = state.expression.slice(-1);

  switch (input) {
    case "C":
    case "clear":
      // Clear all
      state.display = "0";
      state.expression = "";
      break;

    case "CE":
    case "clearEntry":
      // Clear current entry
      state.display = "0";
      break;

    case "=":
    case "equals":
      // Evaluate expression
      if (state.expression) {
        try {
          const result = safeEvaluate(state.expression);
          const resultStr = Number.isInteger(result)
            ? result.toString()
            : result.toFixed(8).replace(/\.?0+$/, "");

          // Add to history
          state.history.push({
            expression: state.expression,
            result: resultStr,
            timestamp: new Date().toISOString(),
          });

          // Keep only last 10 entries
          if (state.history.length > 10) {
            state.history.shift();
          }

          state.display = resultStr;
          state.expression = resultStr;

          return {
            success: true,
            message: `${state.history[state.history.length - 1].expression} = ${resultStr}`,
            state,
            result: resultStr,
          };
        } catch (error) {
          state.display = "Error";
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Calculation error",
            state,
          };
        }
      }
      break;

    case "backspace":
    case "←":
      // Remove last character
      if (state.expression.length > 1) {
        state.expression = state.expression.slice(0, -1);
        state.display = state.expression;
      } else {
        state.expression = "";
        state.display = "0";
      }
      break;

    case "+/-":
    case "negate":
      // Toggle sign
      if (state.display !== "0" && state.display !== "Error") {
        if (state.display.startsWith("-")) {
          state.display = state.display.slice(1);
        } else {
          state.display = "-" + state.display;
        }
        // Update expression
        const parts = state.expression.match(/(.*?)(-?\d+\.?\d*)$/);
        if (parts) {
          const num = parts[2];
          const prefix = parts[1];
          const newNum = num.startsWith("-") ? num.slice(1) : "-" + num;
          state.expression = prefix + newNum;
        }
      }
      break;

    case "MC":
      // Memory clear
      state.memory = 0;
      break;

    case "MR":
      // Memory recall
      state.display = state.memory.toString();
      state.expression = state.memory.toString();
      break;

    case "M+":
      // Memory add
      try {
        state.memory += parseFloat(state.display);
      } catch {
        // Ignore invalid display
      }
      break;

    case "M-":
      // Memory subtract
      try {
        state.memory -= parseFloat(state.display);
      } catch {
        // Ignore invalid display
      }
      break;

    default:
      // Number or operator input
      if (operators.includes(input)) {
        // Operator - prevent double operators
        if (!operators.includes(lastChar) && state.expression) {
          state.expression += input;
          state.display = state.expression;
        } else if (operators.includes(lastChar)) {
          // Replace last operator
          state.expression = state.expression.slice(0, -1) + input;
          state.display = state.expression;
        }
      } else if (input === ".") {
        // Decimal point - check if current number already has one
        const parts = state.expression.split(/[+\-*/]/);
        const currentNum = parts[parts.length - 1];
        if (!currentNum.includes(".")) {
          state.expression += input;
          state.display = state.expression;
        }
      } else if (/^\d$/.test(input)) {
        // Digit
        if (state.expression === "0" || state.display === "Error") {
          state.expression = input;
        } else {
          state.expression += input;
        }
        state.display = state.expression;
      }
      break;
  }

  return {
    success: true,
    message: `Input: ${input}`,
    state,
  };
}

/**
 * Evaluate a full expression directly.
 */
export function evaluateExpression(
  calculatorId: string,
  expression: string,
): CalculatorResult {
  const state = calculators.get(calculatorId);
  if (!state) {
    return { success: false, message: "Calculator not found" };
  }

  try {
    const result = safeEvaluate(expression);
    const resultStr = Number.isInteger(result)
      ? result.toString()
      : result.toFixed(8).replace(/\.?0+$/, "");

    state.history.push({
      expression,
      result: resultStr,
      timestamp: new Date().toISOString(),
    });

    if (state.history.length > 10) {
      state.history.shift();
    }

    state.display = resultStr;
    state.expression = resultStr;

    return {
      success: true,
      message: `${expression} = ${resultStr}`,
      state,
      result: resultStr,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Calculation error",
      state,
    };
  }
}

/**
 * Get calculation history.
 */
export function getHistory(calculatorId: string): CalculatorEntry[] {
  const state = calculators.get(calculatorId);
  return state?.history || [];
}

/**
 * Clear calculation history.
 */
export function clearHistory(calculatorId: string): CalculatorResult {
  const state = calculators.get(calculatorId);
  if (!state) {
    return { success: false, message: "Calculator not found" };
  }

  state.history = [];
  return { success: true, message: "History cleared", state };
}
