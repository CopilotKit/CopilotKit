import { EXPENSE_CSV_PUBLIC_PATH } from "./types";

/**
 * How BOTH arms get the statement in front of the harness.
 *
 * SHARED on purpose, and it is the one piece of Arm A's plumbing Arm C also
 * uses: the two arms are only comparable if the CSV arrives identically, so a
 * second copy of this fetch — with its own port fallback and its own idea of
 * what a bad response means — would quietly make the comparison about the
 * fixture rather than about the streaming seam.
 *
 * It lives here rather than in `as-tool.ts` because that file is Arm A's and is
 * meant to be DELETABLE if Arm C wins; it lives here rather than in `types.ts`
 * because that module is imported by client components and must stay free of
 * server-side URL construction.
 */

/**
 * Where this app is answering, as the SERVER sees itself.
 *
 * One definition, because two things need it and they must agree: the CSV read
 * below, and the ledger URL baked into the harness's own prompt (`prompt.ts`,
 * whose step 4 has codex `curl` a POST at this app). That prompt used to
 * hardcode port 3000, so running the demo on any other port left the harness
 * POSTing into a dead socket — and the filing beat is one of the four this
 * feature exists to show. It failed quietly: the run still finished, the summary
 * was still written, and only the missing `filedTransactionId` values gave it
 * away.
 *
 * `PORT` is what Next reads for its listen port, so reading the same variable is
 * what keeps the two in step.
 */
export const localBaseUrl = (): string =>
  `http://localhost:${process.env.PORT ?? 3000}`;

/**
 * The fixture's URL. A fetch rather than a filesystem read so both arms exercise
 * the same path the browser would.
 */
export const expenseCsvUrl = (): string =>
  `${localBaseUrl()}${EXPENSE_CSV_PUBLIC_PATH}`;

/**
 * The real CSV read.
 *
 * The `response.ok` check is load-bearing, not defensive noise. `fetch` resolves
 * happily on a 404, so without it a wrong port or a renamed fixture writes an
 * HTML error page into `expenses.csv` verbatim and the harness spends SEVERAL
 * MINUTES web-searching the merchants of a Next.js 404 page before writing a
 * confident, wrong summary. Failing here costs a second; not failing costs the
 * demo.
 */
export const fetchExpenseCsv = async (): Promise<string> => {
  const url = expenseCsvUrl();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not read the expense fixture: GET ${url} returned ` +
        `${response.status} ${response.statusText}. Refusing to run the ` +
        `harness — a non-CSV body would be analysed as if it were the ` +
        `statement. Check that the dev server is on this port and that ` +
        `${EXPENSE_CSV_PUBLIC_PATH} is still in public/.`,
    );
  }
  return response.text();
};
