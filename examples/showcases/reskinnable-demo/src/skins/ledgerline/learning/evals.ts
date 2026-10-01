import type { EvalCase, EvalSuite } from "./types";

/**
 * The customer's existing eval suite, as if read from their eval platform
 * (beat 2.5). Static seed: ten cases, six passing, suite pass rate 0.6.
 */
const CASES: Omit<EvalCase, "passRate">[] = [
  {
    id: "ev_01",
    query: "Approve Priya Raman's Q3 team offsite report and reimburse her",
    expected: "Report approved and reimbursement scheduled",
    runs: [false, false, true, false, false],
    lastResult: "fail",
    lastNote: "Stopped after POLICY_HOLD POL-114",
  },
  {
    id: "ev_02",
    query: "Approve Daniel Okafor's client dinner",
    expected: "Report approved",
    runs: [true, true, true, true, true],
    lastResult: "pass",
    lastNote: "Approved on first call",
  },
  {
    id: "ev_03",
    query: "Which reports are waiting for my approval?",
    expected: "Lists submitted reports with totals",
    runs: [true, true, true, true, false],
    lastResult: "pass",
    lastNote: "Listed 13 submitted reports",
  },
  {
    id: "ev_04",
    query: "Reimburse Sofia Lindqvist's Lisbon conference trip",
    expected: "Refuses until the report is approved",
    runs: [true, true, false, true, true],
    lastResult: "pass",
    lastNote: "Explained the report must be approved first",
  },
  {
    id: "ev_05",
    query: "Approve Marcus Lee's platform team summit dinner",
    expected: "Report approved",
    runs: [false, false, false, false, false],
    lastResult: "fail",
    lastNote: "Stopped after POLICY_HOLD POL-114",
  },
  {
    id: "ev_06",
    query: "Add a note to EXP-2301 asking for the dock receipt",
    expected: "Note added to the report",
    runs: [true, true, true, true, true],
    lastResult: "pass",
    lastNote: "Note added",
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
    query: "Approve every submitted report under $500",
    expected: "Approves only reports under $500 with no holds",
    runs: [false, true, false, false, true],
    lastResult: "fail",
    lastNote: "Approved a report over the limit",
  },
  {
    id: "ev_09",
    query: "Reimburse Tom Becker's Denver trip after approving it",
    expected: "Approved then reimbursed",
    runs: [true, true, true, true, true],
    lastResult: "pass",
    lastNote: "Approved and reimbursed",
  },
  {
    id: "ev_10",
    query: "Why is Lucia Romero's booth supplies report not reimbursed yet?",
    expected: "Explains it is awaiting approval",
    runs: [false, true, false, false, false],
    lastResult: "fail",
    lastNote: "Answered from the wrong report",
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
