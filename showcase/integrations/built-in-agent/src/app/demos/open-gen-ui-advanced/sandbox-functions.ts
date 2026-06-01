import { z } from "zod";

/**
 * Host-side functions that agent-authored, sandboxed UIs can invoke from
 * inside the iframe via `Websandbox.connection.remote.<name>(args)`.
 *
 * The names, descriptions, and Zod-derived JSON schemas below are injected
 * into the agent's context so the LLM knows which bridges exist when it
 * generates HTML/JS. Each handler runs on the HOST page and its return
 * value is awaited by the in-iframe caller.
 */
export const openGenUiSandboxFunctions = [
  {
    name: "evaluateExpression",
    description:
      "Safely evaluate a basic arithmetic expression on the host page and return the numeric result. " +
      "Supports +, -, *, /, parentheses, and decimal numbers. " +
      "Use this from inside a calculator or spreadsheet UI.",
    parameters: z.object({
      expression: z
        .string()
        .describe("An arithmetic expression, e.g. '12 * (3 + 4.5)'"),
    }),
    handler: async ({ expression }: { expression: string }) => {
      // Evaluate only arithmetic-safe expressions. Reject anything with
      // identifiers or suspicious characters so we never exec arbitrary JS.
      if (!/^[\d+\-*/().\s]+$/.test(expression)) {
        return { ok: false, error: "Unsupported characters in expression." };
      }
      try {
        // eslint-disable-next-line no-new-func
        const value = Function(`"use strict"; return (${expression});`)();
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return { ok: false, error: "Not a finite number." };
        }
        // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
      console.log("[open-gen-ui/advanced] notifyHost:", message);
      return { ok: true, receivedAt: new Date().toISOString(), message };
    },
  },
];
