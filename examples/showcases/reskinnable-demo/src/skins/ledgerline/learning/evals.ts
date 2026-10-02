import type { EvalCase, EvalSuite } from "./types";

/**
 * The customer's existing eval suite, as if read from their eval platform
 * (beat 2.5). Static seed for the card-close story: ten cases, six passing,
 * suite pass rate 0.6.
 */
const CASES: Omit<EvalCase, "passRate">[] = [
  {
    id: "ev_01",
    query: "Match my unmatched September card transactions to their receipts",
    expected:
      "Every charge paired with its receipts, validated, and handed over for review",
    runs: [false, false, false, true, false],
    lastResult: "fail",
    lastNote: "Validated 4 of 6: UNBALANCED on tip and FX",
  },
  {
    id: "ev_02",
    query: "What's left for the September card close?",
    expected: "Lists each open card and its unmatched charges",
    runs: [true, true, true, true, true],
    lastResult: "pass",
    lastNote: "Listed 2 open cards, 11 unmatched charges",
  },
  {
    id: "ev_03",
    query: "Find the receipt for the Blue Bottle charge on Priya's card",
    expected: "Names the Sep 7 Blue Bottle Coffee receipt",
    runs: [true, true, false, true, true],
    lastResult: "pass",
    lastNote: "Matched SQ *BLUEBOTTLE to Blue Bottle Coffee",
  },
  {
    id: "ev_04",
    query: "Match Marcus Lee's unmatched card transactions",
    expected: "Five pairs validated, handed over for review",
    runs: [false, false, false, false, false],
    lastResult: "fail",
    lastNote:
      "Pairs refused: matches must be created inside a reconciliation session",
  },
  {
    id: "ev_05",
    query: "Which expense reports were submitted this week?",
    expected: "Lists the week's submitted reports with totals",
    runs: [true, true, true, true, false],
    lastResult: "pass",
    lastNote: "Listed 9 reports",
  },
  {
    id: "ev_06",
    query: "Close September for Priya's card",
    expected:
      "Prepares the matches and leaves closing to the cardholder's confirmation",
    runs: [true, true, true, true, true],
    lastResult: "pass",
    lastNote: "Did not close the period itself",
  },
  {
    id: "ev_07",
    query: "What is our receipt policy for meals?",
    expected: "Cites TE-2.3 and TE-3.2",
    runs: [true, true, true, false, true],
    lastResult: "pass",
    lastNote: "Cited TE-2.3",
  },
  {
    id: "ev_08",
    query: "Pair the United charge on Visa 4417 with its receipts",
    expected: "One pair with both United receipts ($598.20 + $88.00)",
    runs: [false, true, false, false, true],
    lastResult: "fail",
    lastNote: "Paired one receipt; validation UNBALANCED",
  },
  {
    id: "ev_09",
    query: "Show Sofia Lindqvist's Lisbon conference report",
    expected: "Report card with line items and status",
    runs: [true, true, true, true, true],
    lastResult: "pass",
    lastNote: "Showed EXP-2295",
  },
  {
    id: "ev_10",
    query: "Convert the Hôtel Le Marais receipt for the card close",
    expected: "fx_conversion adjustment: EUR 372.00 at 1.1086 = $412.40",
    runs: [false, true, false, false, false],
    lastResult: "fail",
    lastNote: "Used the euro total as dollars",
  },
];

export function evalSuite(now = Date.now()): EvalSuite {
  const cases = CASES.map((c) => ({
    ...c,
    passRate: c.runs.filter(Boolean).length / c.runs.length,
  }));
  return {
    suite: "Ledgerline agent evals",
    lastRunAt: now - 3 * 3_600_000,
    passRate:
      cases.filter((c) => c.lastResult === "pass").length / cases.length,
    cases,
  };
}
