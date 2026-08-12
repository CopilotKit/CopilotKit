import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import * as store from "@/skins/logistics/data/store";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/logistics/v1/briefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const valid = {
  carrier: "Pacific Star Line",
  effective: "26 August 2026",
  summary: "Forward rates on the Trans-Pacific strings.",
  plannerId: "pl-rosa",
  laneRates: [
    {
      lane: "SHA-LAX",
      mode: "ocean",
      oldRateUsdPerKg: 0.45,
      newRateUsdPerKg: 0.52,
    },
  ],
  impacts: ["SHA-LAX moves up."],
};

beforeEach(() => {
  store.reset();
});

describe("POST /briefs", () => {
  it("files a brief attributed to the resolved planner, not to the body", async () => {
    const res = await post({
      ...valid,
      filedBy: "Somebody Else",
      role: "Director",
    });
    expect(res.status).toBe(201);
    const [filed] = store.rateBriefs();
    expect(filed.filedBy).toBe("Rosa Delgado");
    expect(filed.role).toBe("Planner");
    expect(filed.carrier).toBe("Pacific Star Line");
  });

  it("keeps a prior rate for a lane the network actually carries", async () => {
    await post(valid);
    expect(store.rateBriefs()[0].laneRates[0].oldRateUsdPerKg).toBe(0.45);
  });

  it("refuses to store a prior rate for a lane the network does not carry", async () => {
    // The failure this exists to close, observed live: the agent copied the
    // QUOTED rate into the prior-rate slot for the one lane the sheet prints as
    // "new", and the artifact rendered "$0.49 → $0.49, flat" under a document
    // that says there is no prior rate on file.
    const res = await post({
      ...valid,
      laneRates: [
        {
          lane: "SHA-OAK",
          mode: "ocean",
          oldRateUsdPerKg: 0.49,
          newRateUsdPerKg: 0.49,
        },
      ],
    });
    expect(res.status).toBe(201);
    expect(store.rateBriefs()[0].laneRates[0].oldRateUsdPerKg).toBeUndefined();
    // And the caller is TOLD, so the agent narrates the correction rather than
    // being silently overruled.
    expect((await res.json()).noPriorRateOnFile).toEqual(["SHA-OAK"]);
  });

  it("matches the network through the case and spacing a retyped lane arrives in", async () => {
    await post({
      ...valid,
      laneRates: [
        {
          lane: " sha-lax ",
          mode: "Ocean",
          oldRateUsdPerKg: 0.45,
          newRateUsdPerKg: 0.52,
        },
      ],
    });
    expect(store.rateBriefs()[0].laneRates[0].oldRateUsdPerKg).toBe(0.45);
  });

  it("needs a carrier and a summary", async () => {
    expect((await post({ ...valid, summary: "" })).status).toBe(400);
    expect((await post({ ...valid, carrier: "   " })).status).toBe(400);
    expect(store.rateBriefs()).toHaveLength(0);
  });

  it("needs a planner it can resolve", async () => {
    expect((await post({ ...valid, plannerId: undefined })).status).toBe(400);
    expect((await post({ ...valid, plannerId: "pl-nobody" })).status).toBe(400);
  });

  it("refuses a row it cannot read rather than coercing it", async () => {
    // `Number(x) || 0` would have mapped this onto a stored 0 — a rate the
    // carrier never quoted, indistinguishable from one it did.
    const res = await post({
      ...valid,
      laneRates: [{ lane: "SHA-LAX", mode: "ocean", newRateUsdPerKg: "$0.52" }],
    });
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain("newRateUsdPerKg");
    expect(store.rateBriefs()).toHaveLength(0);
  });

  it("refuses a brief that would not fit the card, naming the limit", async () => {
    const res = await post({
      ...valid,
      impacts: ["one", "two", "three", "four"],
    });
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain("at most 3");
    expect(store.rateBriefs()).toHaveLength(0);
  });

  it("refuses repeated lanes, which the page would render as one row", async () => {
    const res = await post({
      ...valid,
      laneRates: [
        { lane: "SHA-LAX", mode: "ocean", newRateUsdPerKg: 0.52 },
        { lane: "SHA-LAX", mode: "ocean", newRateUsdPerKg: 0.53 },
      ],
    });
    expect(res.status).toBe(422);
    expect(store.rateBriefs()).toHaveLength(0);
  });

  it("says the sheet did not state an effective date rather than inventing one", async () => {
    await post({ ...valid, effective: "  " });
    expect(store.rateBriefs()[0].effective).toBe("not stated on the sheet");
  });
});

describe("GET /briefs", () => {
  it("serves the filed briefs — the artifact belongs to the app", async () => {
    await post(valid);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });
});
