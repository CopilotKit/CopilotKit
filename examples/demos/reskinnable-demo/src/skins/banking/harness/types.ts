/**
 * Shared vocabulary for the long-running expense harness. SERVER-SAFE and
 * CLIENT-SAFE: plain types plus one pure parser, no JSX and no runtime imports,
 * so `agent.ts` (server), `harness-agent.ts` (server), and the report card
 * (client) can all import it.
 *
 * Every type here is shared by BOTH arms. Only `progress.ts` and `as-tool.ts`
 * are Arm-A-specific.
 */

/** Where the bundled fixture is served from. */
export const EXPENSE_CSV_PUBLIC_PATH = "/sample-expenses-offsite.csv";

/**
 * Arm A's side-channel id. A FIXED constant, not a per-run id: the console must
 * subscribe while the tool is still in flight, and a tool's `runId` only reaches
 * the client in its RESULT. One concurrent harness run per demo instance is a
 * correct constraint for a presenter demo, and it removes the id plumbing.
 */
export const HARNESS_RUN_CHANNEL = "banking-harness";

/** The offsite the harness reasons against. */
export const OFFSITE = {
  city: "Austin",
  startDate: "2026-07-14",
  endDate: "2026-07-16",
} as const;

/** One row of the uploaded statement. */
export interface ExpenseRow {
  date: string;
  merchant: string;
  amount: number;
  city: string;
  cardLast4: string;
  description: string;
}

/** The harness's per-row decision. */
export interface ExpenseVerdict {
  merchant: string;
  date: string;
  amount: number;
  /** `expensable` was filed; `personal` declined; `unclear` needs a human. */
  decision: "expensable" | "personal" | "unclear";
  /** One sentence, in the harness's own words. */
  reason: string;
  /** What the web search established about this merchant, when it searched. */
  merchantKind?: string;
  /** Set when `decision === "expensable"` and the filing call succeeded. */
  filedTransactionId?: string;
}

/** What the harness produces and the React widget renders. */
export interface HarnessSummary {
  rowsRead: number;
  merchantsSearched: number;
  totalExpensable: number;
  totalPersonal: number;
  verdicts: ExpenseVerdict[];
  /** Wall-clock seconds — the "this took minutes" proof. */
  elapsedSeconds: number;
}

/** One frame of Arm A's side-channel. */
export type HarnessProgressEvent =
  | { kind: "thinking"; text: string; at: number }
  | { kind: "tool"; label: string; detail?: string; at: number }
  | { kind: "navigate"; href: string; at: number }
  | { kind: "done"; at: number }
  | { kind: "error"; message: string; at: number };

/**
 * Minimal CSV parse for the bundled fixture. Not a general CSV reader — the
 * fixture is ours and has no quoted fields, and a quoting implementation nothing
 * exercises would be dead code.
 */
export function parseExpenseCsv(text: string): ExpenseRow[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(1)
    .map((line) => {
      const [date, merchant, amount, city, cardLast4, description] =
        line.split(",");
      return {
        date,
        merchant,
        amount: Number(amount),
        city,
        cardLast4,
        description,
      };
    });
}
