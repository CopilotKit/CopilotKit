import { describe, expect, it } from "vitest";

import {
  parseSort,
  parseTop,
  toChargeRow,
  SORT_KEYS,
} from "@/skins/banking/pages/charges-data";
import type { Transaction } from "@/skins/banking/data/data";

const charge = (over: Partial<Transaction> = {}): Transaction => ({
  id: "t-1",
  title: "Amazon Web Services",
  amount: -91_800,
  date: "2026-06-01",
  policyId: "pol-technology",
  cardId: "card-1",
  team: "Engineering",
  category: "Cloud Infrastructure",
  status: "approved",
  ...over,
});

describe("parseSort", () => {
  it("accepts every real sort key", () => {
    for (const k of SORT_KEYS) expect(parseSort(k)).toBe(k);
  });

  // The whole point of returning null rather than a default: the page keys the
  // Sort control's "active" tint on this result, so an unrecognised value must
  // read as NOT SET. Returning "amount_desc" here would light the tint and
  // claim a sort the user never chose.
  it.each([
    ["an unknown value", "banana"],
    ["an empty value", ""],
    ["a near-miss", "amount_descending"],
    ["a case mismatch", "AMOUNT_DESC"],
  ])("treats %s as not set", (_label, raw) => {
    expect(parseSort(raw)).toBeNull();
  });

  it("treats an absent param as not set", () => {
    expect(parseSort(null)).toBeNull();
  });
});

describe("parseTop", () => {
  it("accepts a positive integer", () => {
    expect(parseTop("10")).toBe(10);
  });

  // `?top=-5` used to reach rows.slice(0, -5), which drops the LAST five rows —
  // the opposite of showing a top-5. Zero emptied the table entirely.
  it.each([
    ["a negative", "-5"],
    ["zero", "0"],
    ["a fraction", "7.5"],
    ["a non-number", "ten"],
    ["an empty value", ""],
  ])("rejects %s", (_label, raw) => {
    expect(parseTop(raw)).toBeNull();
  });

  it("treats an absent param as not set", () => {
    expect(parseTop(null)).toBeNull();
  });
});

describe("toChargeRow", () => {
  it("presents ledger spend as a positive amount", () => {
    expect(toChargeRow(charge(), false).amount).toBe(91_800);
  });

  it("renders a derived over-limit status for a pending charge", () => {
    expect(toChargeRow(charge({ status: "pending" }), true).status).toBe(
      "over-limit",
    );
  });

  // over-limit is only meaningful for a charge awaiting approval; an approved
  // charge is already inside the policy's spend, so flagging it would double-count
  // the very condition the badge describes.
  it("does not mark an approved charge over-limit", () => {
    expect(toChargeRow(charge({ status: "approved" }), true).status).toBe(
      "approved",
    );
  });

  it("falls back to a dash when a transaction has no team or category", () => {
    const row = toChargeRow(
      charge({ team: undefined, category: undefined }),
      false,
    );
    expect(row.team).toBe("—");
    expect(row.category).toBe("—");
  });
});
