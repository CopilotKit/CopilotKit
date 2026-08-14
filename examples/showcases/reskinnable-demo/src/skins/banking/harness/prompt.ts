import { localBaseUrl } from "./csv";
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
4. File every "expensable" row against the company ledger. The endpoint takes the
   flat body shown here — exactly the three fields \`merchant\`, \`amount\` and
   \`note\`, nothing else — and answers 201 with the new transaction's id:

   curl -sS -X POST ${localBaseUrl()}/api/banking/v1/transactions \\
     -H 'content-type: application/json' \\
     -w '%{http_code}' \\
     -d '{"merchant":"Hotel Verrano","amount":318.55,"note":"Offsite ${OFFSITE.city} — reimbursable"}'

   A success is status 201 and a body of {"id":"txn_..."}. The \`-w\` flag prints
   the status code after the body so you can actually see it. Take that row's
   \`filedTransactionId\` from the \`id\` field of that 201 body and from nowhere
   else.

   CHECK EVERY SINGLE CALL BEFORE MOVING ON. If a call does not come back 201
   with an \`id\`, then for that row you must:
     - NOT invent, guess, pattern-match, or reuse a transaction id;
     - leave \`filedTransactionId\` absent from that row entirely;
     - state in that row's \`reason\` that the filing failed, with the status code
       you got back.
   A made-up id is far worse than a failed filing: it tells the reader money
   moved when it did not. Never write an id you did not read out of a 201 body.
5. Write \`summary.json\` in your working directory. THIS FILE IS THE
   DELIVERABLE — if you do not write it, all of your work is discarded. The
   fields mean:
     - \`rowsRead\` — how many data rows you read out of the CSV.
     - \`merchantsSearched\` — how many DISTINCT merchants you web-searched.
     - \`totalExpensable\` — the SUM OF THE \`amount\` VALUES of every row you
       decided "expensable". A dollar total, NOT a count of rows.
     - \`totalPersonal\` — the SUM OF THE \`amount\` VALUES of every row you
       decided "personal". Again a dollar total, NOT a count of rows.
       Rows you marked "unclear" belong to NEITHER total.
     - \`verdicts\` — one entry per CSV row, in the order the rows appear.
   Exact shape, no extra keys (\`merchantKind\` and \`filedTransactionId\` are the
   only optional ones — omit them rather than writing a placeholder):

{
  "rowsRead": 14,
  "merchantsSearched": 5,
  "totalExpensable": 1284.63,
  "totalPersonal": 412.18,
  "verdicts": [
    {
      "merchant": "Hotel Verrano",
      "date": "2026-07-14",
      "amount": 318.55,
      "decision": "expensable",
      "reason": "Lodging on the first night of the ${OFFSITE.city} offsite.",
      "merchantKind": "hotel",
      "filedTransactionId": "txn_4f2a91"
    },
    {
      "merchant": "Lumen Streaming",
      "date": "2026-07-09",
      "amount": 17.99,
      "decision": "personal",
      "reason": "A monthly entertainment subscription, unrelated to the offsite.",
      "merchantKind": "streaming service"
    }
  ]
}

Work carefully and take the time you need. Narrate what you are doing as you go.`;
