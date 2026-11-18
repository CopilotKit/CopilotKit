import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { OFFSITE, parseExpenseCsv } from "./types";

const FIXTURE = "public/sample-expenses-offsite.csv";

describe("parseExpenseCsv", () => {
  it("parses the bundled fixture into typed rows", () => {
    const rows = parseExpenseCsv(readFileSync(FIXTURE, "utf8"));

    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({
      date: "2026-07-14",
      merchant: "Ascend Air 4471",
      amount: 842.1,
      city: "San Francisco",
      cardLast4: "4242",
      description: "AIRFARE SFO-AUS",
    });
  });

  it("ignores a trailing newline rather than emitting an empty row", () => {
    const rows = parseExpenseCsv(
      "date,merchant,amount,city,card_last4,description\n" +
        "2026-07-14,X,1.50,Austin,4242,Y\n",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1.5);
  });
});

describe("the OFFSITE window and the bundled fixture", () => {
  // The harness prompt classifies each row by whether it falls inside the
  // offsite — `OFFSITE.city` plus the `startDate`..`endDate` window — and those
  // two halves live in different files. Nothing else couples them: edit a date in
  // the CSV, or move a boundary in `OFFSITE`, and `pnpm lint`, `pnpm typecheck`,
  // `pnpm test:unit` and `pnpm build` all stay green while the feature silently
  // misclassifies expenses. Because the misclassification is a judgement call the
  // agent narrates in prose, it does not look like a bug in the demo either.
  //
  // These are that catch. ISO `YYYY-MM-DD` strings order lexicographically, so
  // plain string comparison is a correct date comparison here and needs no Date
  // parsing (which would drag timezones into it).
  const rows = parseExpenseCsv(readFileSync(FIXTURE, "utf8"));

  it("dates every in-city row inside the offsite window", () => {
    const offsiteCityRows = rows.filter((row) => row.city === OFFSITE.city);

    // Guards the premise as well as the dates: if `OFFSITE.city` stops matching
    // the fixture's spelling, there are no rows to range-check and the range
    // assertion below would pass vacuously.
    expect(offsiteCityRows.length).toBeGreaterThan(0);

    for (const row of offsiteCityRows) {
      expect(
        row.date >= OFFSITE.startDate && row.date <= OFFSITE.endDate,
        `${row.merchant} on ${row.date} is in ${OFFSITE.city} but outside ` +
          `${OFFSITE.startDate}..${OFFSITE.endDate}`,
      ).toBe(true);
    }
  });

  it("anchors a row on each boundary of the window", () => {
    // Without a row on each edge, an inclusive/exclusive mistake at either
    // boundary is unobservable.
    expect(rows.map((row) => row.date)).toContain(OFFSITE.startDate);
    expect(rows.map((row) => row.date)).toContain(OFFSITE.endDate);
  });

  it("keeps rows on both sides of the window so the split is demonstrable", () => {
    // The demo's whole point is expensable vs personal. A fixture whose rows all
    // fell inside the window would still satisfy the checks above while giving
    // the harness nothing to decline.
    expect(
      rows.some((row) => row.city !== OFFSITE.city),
      "no out-of-city rows: nothing for the harness to classify as personal",
    ).toBe(true);
    expect(
      rows.some((row) => row.date > OFFSITE.endDate),
      "no rows after the offsite: the post-trip spend is what makes the " +
        "date window load-bearing rather than decorative",
    ).toBe(true);
  });
});
