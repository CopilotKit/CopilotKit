import { z } from "zod";

// @region[sandbox-function-registration]
/**
 * Host-side functions that agent-authored, sandboxed UIs can invoke from
 * inside the iframe via `Websandbox.connection.remote.<name>(args)`.
 */
export const openGenUiSandboxFunctions = [
  {
    name: "evaluateExpression",
    description:
      "Safely evaluate a basic arithmetic expression on the host page and return the numeric result. " +
      "Supports +, -, *, /, parentheses, and decimal numbers.",
    parameters: z.object({
      expression: z
        .string()
        .describe("An arithmetic expression, e.g. '12 * (3 + 4.5)'"),
    }),
    handler: async ({ expression }: { expression: string }) => {
      if (!/^[\d+\-*/().\s]+$/.test(expression)) {
        return { ok: false, error: "Unsupported characters in expression." };
      }
      try {
        // eslint-disable-next-line no-new-func
        const value = Function(`"use strict"; return (${expression});`)();
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return { ok: false, error: "Not a finite number." };
        }
        console.log(
          "[open-gen-ui/advanced] evaluateExpression",
          expression,
          "=",
          value,
        );
        return { ok: true, value };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  },
  {
    name: "notifyHost",
    description:
      "Send a short notification message from the sandboxed UI to the host page. " +
      "The host logs the message and returns a confirmation object.",
    parameters: z.object({
      message: z.string().describe("A short status message."),
    }),
    handler: async ({ message }: { message: string }) => {
      console.log("[open-gen-ui/advanced] notifyHost:", message);
      return { ok: true, receivedAt: new Date().toISOString(), message };
    },
  },
];
// @endregion[sandbox-function-registration]
