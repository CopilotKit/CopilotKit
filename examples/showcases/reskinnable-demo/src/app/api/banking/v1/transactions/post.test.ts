import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import * as store from "@/skins/banking/data/store";

const post = (body: unknown) =>
  POST(
    new Request("http://test/api/banking/v1/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

/**
 * The existing `GET` responds with a BARE ARRAY (`store.transactions()`), not a
 * `{ transactions: [...] }` envelope — same as every other banking v1 list
 * route. The visibility test below reads it as an array for that reason.
 */
const getLength = async () =>
  ((await (await GET()).json()) as unknown[]).length;

describe("POST /api/banking/v1/transactions", () => {
  beforeEach(() => store.reset());

  it("files a harness-shaped charge and returns its id", async () => {
    const response = await post({
      merchant: "Hotel Verrano",
      amount: 318.55,
      note: "Offsite Austin — reimbursable",
    });
    expect(response.status).toBe(201);

    const { id } = (await response.json()) as { id: string };
    expect(id).toBeTruthy();

    const filed = store.findTransaction(id);
    expect(filed).toBeDefined();
    // The route owns the mapping: merchant -> title, note string -> note object.
    expect(filed!.title).toBe("Hotel Verrano");
    // The caller sends a positive expense magnitude; THE LEDGER STORES SPEND AS
    // NEGATIVE (see `ChargeRow.amount` in pages/charges-data.ts). A positive
    // amount is read as INCOME everywhere in this skin — it is excluded from
    // the spend charts (`analytics-charts.tsx` skips `t.amount >= 0`) and the
    // approvals queue renders it as a credit — so the route normalizes the sign
    // rather than making the harness learn the convention.
    expect(filed!.amount).toBe(-318.55);
    expect(filed!.status).toBe("pending");
    expect(filed!.note?.content).toBe("Offsite Austin — reimbursable");
    // Required model fields the caller never supplies must still be populated.
    expect(filed!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(filed!.policyId).toBeTruthy();
    expect(filed!.cardId).toBeTruthy();
    // The filed row must hang off a policy that actually RESOLVES, or it drops
    // out of the over-limit derivation and the report's per-policy grouping.
    expect(store.findPolicy(filed!.policyId)).toBeDefined();
    expect(store.findCard(filed!.cardId)).toBeDefined();
  });

  it("makes the filed charge visible to the existing GET", async () => {
    const before = await getLength();
    await post({ merchant: "Rideshare Co 88213", amount: 24.15 });
    const after = await getLength();
    expect(after).toBe(before + 1);
  });

  it("accepts a charge with no note", async () => {
    const response = await post({ merchant: "Ascend Air 4471", amount: 842.1 });
    expect(response.status).toBe(201);
  });

  it("rejects a missing or empty merchant with 400", async () => {
    expect((await post({ amount: 10 })).status).toBe(400);
    expect((await post({ merchant: "   ", amount: 10 })).status).toBe(400);
  });

  it("rejects a non-finite amount with 400", async () => {
    expect((await post({ merchant: "X", amount: "10" })).status).toBe(400);
    expect((await post({ merchant: "X", amount: Number.NaN })).status).toBe(
      400,
    );
  });
});
