import { afterEach, describe, expect, it } from "vitest";
import { buildHarnessPrompt } from "./prompt";
import { expenseCsvUrl } from "./csv";
import { OFFSITE } from "./types";

/**
 * The prompt IS the beat: the per-merchant search, the offsite reasoning, the
 * filing, and the `summary.json` contract `readSummary` parses. Nothing else
 * enforces any of it.
 *
 * These are the two claims in it that go wrong SILENTLY — a run that still
 * finishes, still writes a summary, and still renders a report card, with the
 * evidence missing rather than an error anywhere.
 */

const set = (value: string | undefined) => {
  if (value === undefined) delete process.env.PORT;
  else process.env.PORT = value;
};

const original = process.env.PORT;
afterEach(() => set(original));

describe("buildHarnessPrompt", () => {
  it("points the filing curl at the port this app is actually serving", () => {
    // The hardcoded `localhost:3000` this replaced meant that running the demo
    // on any other port left codex POSTing into a dead socket: no 201, no
    // transaction id, no filed charges — and the run otherwise looked normal.
    set("3010");
    const prompt = buildHarnessPrompt();
    expect(prompt).toContain(
      "http://localhost:3010/api/banking/v1/transactions",
    );
    expect(prompt).not.toContain("localhost:3000");
  });

  it("uses the SAME origin the CSV is fetched from", () => {
    // Two URLs, one server. If these ever diverge, the harness reads a statement
    // from one app and files charges against another.
    set("4123");
    expect(buildHarnessPrompt()).toContain(new URL(expenseCsvUrl()).origin);
  });

  it("defaults to 3000 when PORT is unset", () => {
    set(undefined);
    expect(buildHarnessPrompt()).toContain("http://localhost:3000/api/");
  });

  it("states the offsite the verdicts are reasoned against", () => {
    // Every "expensable" decision cites these. A prompt that lost them would
    // still produce confident verdicts — against no trip at all.
    const prompt = buildHarnessPrompt();
    expect(prompt).toContain(OFFSITE.city);
    expect(prompt).toContain(OFFSITE.startDate);
    expect(prompt).toContain(OFFSITE.endDate);
  });

  it("names every field readSummary needs, so the deliverable parses", () => {
    // `readSummary` reads these off summary.json. A prompt that stopped asking
    // for one yields a report card rendering `undefined` where a number belongs.
    const prompt = buildHarnessPrompt();
    for (const field of [
      "rowsRead",
      "merchantsSearched",
      "totalExpensable",
      "totalPersonal",
      "verdicts",
      "filedTransactionId",
    ]) {
      expect(prompt, `${field} is no longer requested`).toContain(field);
    }
  });
});
