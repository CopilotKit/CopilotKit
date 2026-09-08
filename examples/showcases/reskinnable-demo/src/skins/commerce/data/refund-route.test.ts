import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/commerce/v1/returns/[id]/refund/route";
import * as store from "./store";

/**
 * BEAT 3a's route, tested where the untrusted JSON actually enters.
 *
 * This lives beside the store rather than beside the route because the two
 * halves of one rule are here: the route owns "is this even a number the body
 * carried", the store owns "is that number a usable refund". A test of either
 * half alone passes while a real refund settles for the wrong figure.
 *
 * The failure this pins is not a 500 or a bad message — it is a SETTLED refund.
 * `Number(body?.amount)` used to coerce, so `{"amount": true}` became `1`: a
 * finite, positive, under-the-ceiling figure that walked past every guard the
 * store has and marked Marguerite Bell's return `refunded` for one dollar,
 * terminally, with a 200. Every assertion below therefore also checks that the
 * return is STILL approved with no refundAmount, because "422" alone would not
 * have caught the bug had the write happened first.
 */

const APPROVED = "ret-2210"; // seeded `approved`, itemValue 340

const post = (id: string, body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/commerce/v1/returns/${id}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const target = () => store.returns().find((r) => r.id === APPROVED);

beforeEach(() => store.reset());

describe("POST returns/[id]/refund — the amount is not coerced", () => {
  // `true` is the headline: it coerced to a real $1 refund. The rest are the
  // same hole in other clothes — a string that looks like money, and the three
  // values `Number` turns into 0.
  it.each([
    { label: "a boolean", amount: true },
    { label: "a numeric string", amount: "12" },
    { label: "an empty array", amount: [] },
    { label: "null", amount: null },
    { label: "an empty string", amount: "" },
    { label: "an object", amount: { valueOf: 50 } },
  ])("refuses $label without settling the return", async ({ amount }) => {
    const res = await post(APPROVED, { amount });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "INVALID_AMOUNT",
      message: "That is not a usable amount.",
    });
    expect(target()?.status).toBe("approved");
    expect(target()?.refundAmount).toBeNull();
  });

  it("refuses a body with no amount at all", async () => {
    const res = await post(APPROVED, {});
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_AMOUNT",
    });
    expect(target()?.status).toBe("approved");
  });

  // These arrive as genuine JSON numbers, so the type gate lets them through —
  // the store's own range rules are what refuse them, and this asserts the
  // route still reaches them rather than having grown a second copy that drifts.
  it.each([
    { label: "a negative amount", amount: -5, error: "INVALID_AMOUNT" },
    { label: "zero", amount: 0, error: "INVALID_AMOUNT" },
    // JSON.parse turns an overflowing literal into Infinity.
    { label: "an overflowing literal", amount: 1e999, error: "INVALID_AMOUNT" },
    {
      label: "an absurdly large amount",
      amount: 9_999_999_999,
      error: "REFUND_EXCEEDS_VALUE",
    },
    {
      label: "a dollar over what was charged",
      amount: 341,
      error: "REFUND_EXCEEDS_VALUE",
    },
  ])(
    "refuses $label without settling the return",
    async ({ amount, error }) => {
      const res = await post(APPROVED, { amount });
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({ error });
      expect(target()?.status).toBe("approved");
      expect(target()?.refundAmount).toBeNull();
    },
  );

  it("still refunds a legitimate amount on an approved return", async () => {
    const res = await post(APPROVED, { amount: 85.5 });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: APPROVED,
      status: "refunded",
      refundAmount: 85.5,
    });
    expect(target()?.status).toBe("refunded");
  });

  // The status precondition is a different rule from this one and both have to
  // hold: a well-typed figure on an undecided return is still refused.
  it("leaves the approved-only precondition intact", async () => {
    const res = await post("ret-2204", { amount: 50 });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "RETURN_NOT_APPROVED",
    });
    expect(
      store.returns().find((r) => r.id === "ret-2204")?.refundAmount,
    ).toBeNull();
  });
});
