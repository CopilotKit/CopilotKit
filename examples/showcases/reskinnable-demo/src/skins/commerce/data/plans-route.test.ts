import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/commerce/v1/plans/route";
import * as store from "./store";

/**
 * BEAT 3d's write path — the validation in front of the DURABLE artifact.
 *
 * Every assertion here pins the same failure mode, and it is the worst kind this
 * app has: the route used to COERCE whatever the model sent and report success.
 * A twelve-SKU price sheet became an eight-row plan, `null` became the bullet
 * "null", `{}` became "[object Object]", `"$52"` and a genuine `$0` both became
 * `0`, and an empty season became a card with no title. The tool answered "Filed
 * the plan" in every one of those cases, the agent then narrated FROM the record,
 * and the record outlives the thread. A refusal is recoverable; a plausible-
 * looking wrong artifact is not, because nobody in the room can see it.
 */

const post = (body: unknown) =>
  POST({ json: async () => body } as unknown as NextRequest);

/** The shape beat 3d actually files, from the four-line seeded price sheet. */
const validPlan = () => ({
  vendor: "Kestrel Mills",
  season: "Autumn knitwear",
  summary: "Autumn knit buy at the quoted landed costs.",
  highlights: ["Cedar Hoodie up to $51", "FOB mill, net 45"],
  lines: [
    { sku: "BW-CDR-HDY", name: "Cedar Hoodie", landedCost: 51, units: 1200 },
    { sku: "BW-ALD-CRW", name: "Alder Crewneck", landedCost: 52, units: 900 },
  ],
  schedule: [
    { week: "Week 1", item: "PO countersigned" },
    { week: "Week 6", item: "Bulk leaves the mill" },
  ],
  filedBy: "Nadia Okonjo",
});

beforeEach(() => store.reset());

describe("POST /api/commerce/v1/plans — the happy path still files", () => {
  it("files the plan the demo's own price sheet produces, intact", async () => {
    const before = store.plans().length;
    const res = await post(validPlan());
    expect(res.status).toBe(201);

    const plan = await res.json();
    expect(store.plans()).toHaveLength(before + 1);
    expect(plan.vendor).toBe("Kestrel Mills");
    expect(plan.season).toBe("Autumn knitwear");
    expect(plan.highlights).toEqual([
      "Cedar Hoodie up to $51",
      "FOB mill, net 45",
    ]);
    expect(plan.lines).toHaveLength(2);
    expect(plan.schedule).toHaveLength(2);
    expect(plan.filedBy).toBe("Nadia Okonjo");
  });

  it("defaults an OMITTED season and filedBy rather than refusing them", async () => {
    const { season, filedBy, ...rest } = validPlan();
    expect(season).toBeTruthy(); // the fields really are omitted below
    expect(filedBy).toBeTruthy();

    const res = await post(rest);
    expect(res.status).toBe(201);
    const plan = await res.json();
    expect(plan.season).toBe("Unscheduled");
    expect(plan.filedBy).toBe("Bellwether");
  });

  it("treats absent arrays as empty, so a summary-only plan still files", async () => {
    const res = await post({
      vendor: "Kestrel Mills",
      summary: "Placeholder while the sheet is countersigned.",
    });
    expect(res.status).toBe(201);
    const plan = await res.json();
    expect(plan.highlights).toEqual([]);
    expect(plan.lines).toEqual([]);
    expect(plan.schedule).toEqual([]);
  });
});

describe("POST /api/commerce/v1/plans — over-limit is REFUSED, never trimmed", () => {
  const row = (n: number) => ({
    sku: `BW-SKU-${n}`,
    name: `Style ${n}`,
    landedCost: 40 + n,
    units: 100 * (n + 1),
  });

  it("refuses a twelve-SKU sheet instead of storing eight rows", async () => {
    const before = store.plans().length;
    const res = await post({
      ...validPlan(),
      lines: Array.from({ length: 12 }, (_, i) => row(i)),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("PLAN_TOO_LARGE");
    expect(body.message).toContain("8"); // the limit is named, so a retry can fit
    expect(body.message).toContain("12"); // and so is what was sent
    // The whole point: nothing was written.
    expect(store.plans()).toHaveLength(before);
  });

  it("refuses a fourth highlight instead of dropping it", async () => {
    const res = await post({
      ...validPlan(),
      highlights: ["one", "two", "three", "four"],
    });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "PLAN_TOO_LARGE",
    });
  });

  it("refuses a ninth schedule step instead of dropping it", async () => {
    const res = await post({
      ...validPlan(),
      schedule: Array.from({ length: 9 }, (_, i) => ({
        week: `Week ${i + 1}`,
        item: `Step ${i + 1}`,
      })),
    });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "PLAN_TOO_LARGE",
    });
  });

  it("accepts EXACTLY the limit, so the budget is a cap and not an off-by-one", async () => {
    const res = await post({
      ...validPlan(),
      highlights: ["one", "two", "three"],
      lines: Array.from({ length: 8 }, (_, i) => row(i)),
      schedule: Array.from({ length: 8 }, (_, i) => ({
        week: `Week ${i + 1}`,
        item: `Step ${i + 1}`,
      })),
    });
    expect(res.status).toBe(201);
    const plan = await res.json();
    expect(plan.lines).toHaveLength(8);
    expect(plan.schedule).toHaveLength(8);
    expect(plan.highlights).toHaveLength(3);
  });
});

describe("POST /api/commerce/v1/plans — no String() coercion reaches the artifact", () => {
  it.each([
    ["null", null],
    ["an object", { text: "nope" }],
    ["a number", 12],
    ["an empty string", ""],
    ["whitespace", "   "],
  ])("refuses %s in highlights rather than storing it", async (_label, bad) => {
    const before = store.plans().length;
    const res = await post({
      ...validPlan(),
      highlights: ["Cedar Hoodie up to $51", bad],
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("INVALID_PLAN_FIELD");
    expect(body.message).toContain("highlights[1]");
    expect(store.plans()).toHaveLength(before);
  });

  it("never lets 'null' or '[object Object]' onto a filed plan", async () => {
    await post({ ...validPlan(), highlights: [null] });
    await post({ ...validPlan(), highlights: [{}] });
    const stored = store.plans().flatMap((p) => p.highlights);
    expect(stored).not.toContain("null");
    expect(stored).not.toContain("[object Object]");
  });

  it("refuses a highlights that is not an array at all", async () => {
    const res = await post({ ...validPlan(), highlights: "just one fact" });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_PLAN_FIELD",
      message: "highlights must be an array.",
    });
  });

  it("refuses an object vendor rather than filing '[object Object]'", async () => {
    const res = await post({ ...validPlan(), vendor: { name: "Kestrel" } });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "BAD_REQUEST" });
    expect(store.plans().map((p) => p.vendor)).not.toContain("[object Object]");
  });

  it("refuses an object filedBy rather than attributing the plan to '[object Object]'", async () => {
    const res = await post({ ...validPlan(), filedBy: { name: "Nadia" } });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_PLAN_FIELD",
      message: "filedBy must be a non-empty string.",
    });
  });

  it.each([
    ["a null row", null],
    ["a string row", "BW-CDR-HDY"],
    ["an array row", ["BW-CDR-HDY"]],
  ])("refuses %s in lines", async (_label, bad) => {
    const res = await post({ ...validPlan(), lines: [bad] });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_PLAN_FIELD",
      message: "lines[0] must be an object.",
    });
  });

  it("refuses a line with a blank sku, which the page uses as its React key", async () => {
    const res = await post({
      ...validPlan(),
      lines: [{ sku: "", name: "Cedar Hoodie", landedCost: 51, units: 1200 }],
    });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      message: "lines[0].sku must be a non-empty string.",
    });
  });

  it("refuses a repeated sku, which would collide the card's React keys", async () => {
    const line = {
      sku: "BW-CDR-HDY",
      name: "Cedar Hoodie",
      landedCost: 51,
      units: 1200,
    };
    const res = await post({ ...validPlan(), lines: [line, { ...line }] });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_PLAN_FIELD",
      message: "lines[].sku must not repeat; the page keys its rows off them.",
    });
  });

  it("refuses a schedule step missing its week or item", async () => {
    const res = await post({
      ...validPlan(),
      schedule: [{ week: "Week 1", item: null }],
    });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      message: "schedule[0].item must be a non-empty string.",
    });
  });
});

describe("POST /api/commerce/v1/plans — the money the margin narrative is built on", () => {
  const withCost = (landedCost: unknown, units: unknown = 1200) => ({
    ...validPlan(),
    lines: [{ sku: "BW-CDR-HDY", name: "Cedar Hoodie", landedCost, units }],
  });

  it.each([
    ["a negative cost", -500],
    ["an absurd cost", 1e9],
    ["a currency string", "$52"],
    ["a numeric string", "52"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s instead of filing 0", async (_label, cost) => {
    const before = store.plans().length;
    const res = await post(withCost(cost));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("INVALID_PLAN_FIELD");
    expect(body.message).toContain("lines[0].landedCost");
    expect(store.plans()).toHaveLength(before);
  });

  it.each([
    ["a negative unit count", -10],
    ["a fractional unit count", 12.5],
    ["an absurd unit count", 1e12],
  ])("refuses %s", async (_label, units) => {
    const res = await post(withCost(51, units));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_PLAN_FIELD",
    });
  });

  // The distinguishability requirement: `Number(x) || 0` mapped a genuine zero
  // and every unparseable value onto the same stored 0. A genuine zero has to
  // survive, and survive as a NUMBER, or the card renders "$NaN".
  it("keeps a genuine 0 cost, distinct from everything refused above", async () => {
    const res = await post(withCost(0, 0));
    expect(res.status).toBe(201);
    const plan = await res.json();
    expect(plan.lines[0].landedCost).toBe(0);
    expect(typeof plan.lines[0].landedCost).toBe("number");
    expect(plan.lines[0].units).toBe(0);
  });
});

describe("POST /api/commerce/v1/plans — season", () => {
  it.each([
    ["an empty season", ""],
    ["a whitespace season", "  "],
  ])("refuses %s rather than filing a blank card title", async (_l, season) => {
    const before = store.plans().length;
    const res = await post({ ...validPlan(), season });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_PLAN_FIELD",
      message: "season must be a non-empty string.",
    });
    expect(store.plans()).toHaveLength(before);
  });

  it("trims a padded season instead of storing the padding", async () => {
    const res = await post({ ...validPlan(), season: "  Autumn knitwear " });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      season: "Autumn knitwear",
    });
  });
});

describe("POST /api/commerce/v1/plans — the required scalars keep their 400", () => {
  it.each([
    ["no vendor", { summary: "Autumn knit buy." }],
    ["no summary", { vendor: "Kestrel Mills" }],
    ["a blank vendor", { vendor: "   ", summary: "Autumn knit buy." }],
  ])("answers 400 for %s", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "BAD_REQUEST",
      message: "A plan needs a vendor and a summary.",
    });
  });
});

describe("POST /api/commerce/v1/plans — a real fault is still a logged 500", () => {
  it("does not report a malformed body as a validation refusal", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST({
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as NextRequest);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "INTERNAL_ERROR",
    });
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
