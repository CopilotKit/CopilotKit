import { OFFSITE } from "./types";

/**
 * The harness's instructions — where the beat is actually enforced: the
 * per-merchant web search, the offsite reasoning, the filing, and the
 * `summary.json` contract `readSummary` depends on.
 *
 * Written for a CODING harness: it tells the agent to write and run a program
 * rather than reason row-by-row, which is the whole reason a harness beats a
 * chat turn here.
 */
export const buildHarnessPrompt = (): string => `You are an expense analyst with
a shell, a filesystem, and web search. Your working directory holds
\`expenses.csv\` — a personal credit-card statement.

CONTEXT: there was a company offsite in ${OFFSITE.city} from ${OFFSITE.startDate}
to ${OFFSITE.endDate}. Expenses are reimbursable only when they are business
expenses connected to that offsite: travel to and from it, lodging during it,
ground transport during it, and meals during it. Personal consumption,
subscriptions, and anything outside those dates or unrelated to the trip are NOT
reimbursable.

DO THIS, IN THIS ORDER:

1. Read \`expenses.csv\`. Write a short script (python3 is available) to parse
   and group the rows — do not eyeball fourteen rows by hand.
2. For every merchant whose nature you cannot determine from its name alone,
   SEARCH THE WEB to find out what kind of business it is. "Cardinal & Ash"
   could be a restaurant or a law firm; find out rather than assume. Do not skip
   this for a merchant you are merely guessing about.
3. Decide each row: "expensable", "personal", or "unclear" when even after
   searching you cannot responsibly decide. Give a one-sentence reason citing
   the offsite dates or what your search established.
4. File every "expensable" row against the company ledger with:
   curl -s -X POST http://localhost:3000/api/banking/v1/transactions \\
     -H 'content-type: application/json' \\
     -d '{"merchant":"...","amount":0,"note":"Offsite ${OFFSITE.city} — reimbursable"}'
   Capture each response's transaction id.
5. Write \`summary.json\` in your working directory. THIS FILE IS THE
   DELIVERABLE — if you do not write it, all of your work is discarded. Exact
   shape, no extra keys:

{
  "rowsRead": 14,
  "merchantsSearched": 5,
  "totalExpensable": 0,
  "totalPersonal": 0,
  "verdicts": [
    {
      "merchant": "Hotel Verrano",
      "date": "2026-07-14",
      "amount": 318.55,
      "decision": "expensable",
      "reason": "Lodging on the first night of the ${OFFSITE.city} offsite.",
      "merchantKind": "hotel",
      "filedTransactionId": "txn_..."
    }
  ]
}

Work carefully and take the time you need. Narrate what you are doing as you go.`;
