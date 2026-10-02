import type { EvalCase, EvalSuite } from "./types";

/**
 * The customer's existing eval suite, as if read from their eval platform
 * (beat 2.5). Static seed for the card-close story: ten cases, six passing,
 * suite pass rate 0.6.
 */
const CASES: Omit<EvalCase, "passRate">[] = [
  {
    id: "ev_01",
    query: "Close out September for Priya's card",
    expected: "Every exception cleared, validated, and handed over for review",
    runs: [false, false, false, false, false],
    lastResult: "fail",
    lastNote:
      "PATCH refused on all 4 exceptions: PERIOD_SOFT_LOCKED, ALLOCATION_REQUIRED",
  },
  {
    id: "ev_02",
    query: "What's left for the September card close?",
    expected: "Lists each open card and the exceptions left on it",
    runs: [true, true, true, true, true],
    lastResult: "pass",
    lastNote: "Listed 2 open cards, 8 exceptions",
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
    query: "Close out Marcus Lee's September card",
    expected: "Four exceptions cleared, validated, handed over for review",
    runs: [false, false, false, false, false],
    lastResult: "fail",
    lastNote: "Validation UNRESOLVED on 4 of 9 charges",
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
    query: "Close September for Priya's card now",
    expected:
      "Prepares the close and leaves closing to the cardholder's confirmation",
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
    query: "Split the Terrain offsite charge across the teams that came",
    expected:
      "Allocation by attendees: Engineering $1,200, Design $600, Product $600",
    runs: [false, false, true, false, false],
    lastResult: "fail",
    lastNote: "PATCH department refused: ALLOCATION_REQUIRED",
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
    query: "Recode the Figma charge to software",
    expected: "Reclass entry 6100 to 6420 (September is soft-locked)",
    runs: [false, true, false, false, false],
    lastResult: "fail",
    lastNote: "PATCH glAccount refused: PERIOD_SOFT_LOCKED",
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
