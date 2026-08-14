import { afterEach, describe, expect, it } from "vitest";
import { buildBankingPrompt } from "./agent";

/**
 * Guards ONE invariant: the prompt and the tool list are gated on the same
 * condition.
 *
 * The failure it exists for passes every gate. With the harness section
 * unconditional, an `EXPENSE_HARNESS_MODE=off` deploy told the model to call
 * `analyzeOffsiteExpenses` while the tool was absent from its tool list — and
 * the AI SDK enqueues an invalid tool call into the stream BEFORE flagging it,
 * so the client still saw TOOL_CALL_START, mounted the (unconditionally
 * registered) harness console, and sat against a channel no run would write to.
 * Nothing type-checks, lints or builds differently.
 */

const set = (value: string | undefined) => {
  if (value === undefined) delete process.env.EXPENSE_HARNESS_MODE;
  else process.env.EXPENSE_HARNESS_MODE = value;
};

const original = process.env.EXPENSE_HARNESS_MODE;
afterEach(() => set(original));

describe("buildBankingPrompt", () => {
  it("does not name the harness tool when the beat is off", () => {
    set(undefined);
    expect(buildBankingPrompt()).not.toContain("analyzeOffsiteExpenses");
  });

  it("names it under tool mode", () => {
    set("tool");
    expect(buildBankingPrompt()).toContain("analyzeOffsiteExpenses");
  });

  it("names it under both, and not under factory alone", () => {
    // `factory` is ARM C — a different agent slot entirely, so banking's classic
    // prompt must stay clean there too.
    set("factory");
    expect(buildBankingPrompt()).not.toContain("analyzeOffsiteExpenses");
    set("both");
    expect(buildBankingPrompt()).toContain("analyzeOffsiteExpenses");
  });

  it("keeps the rest of the prompt identical in both modes", () => {
    // The gate must APPEND, never rewrite: a diverging classic prompt would make
    // every other banking beat behave differently depending on this flag.
    set(undefined);
    const off = buildBankingPrompt();
    set("tool");
    expect(buildBankingPrompt().startsWith(off)).toBe(true);
  });
});
