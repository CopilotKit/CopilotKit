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
 * The fixture's URL. A fetch rather than a filesystem read so both arms exercise
 * the same path the browser would.
 */
export const expenseCsvUrl = (): string =>
  `http://localhost:${process.env.PORT ?? 3000}${EXPENSE_CSV_PUBLIC_PATH}`;

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
