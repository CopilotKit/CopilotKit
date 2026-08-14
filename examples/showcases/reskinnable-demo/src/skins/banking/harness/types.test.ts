import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseExpenseCsv } from "./types";

describe("parseExpenseCsv", () => {
  it("parses the bundled fixture into typed rows", () => {
    const rows = parseExpenseCsv(
      readFileSync("public/sample-expenses-offsite.csv", "utf8"),
    );

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
