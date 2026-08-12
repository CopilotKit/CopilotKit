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

  it("settles a prior rate the model OMITTED for a lane the carrier serves", async () => {
    // The mirror of the defect below, and the same lie on the same row: left
    // absent, `movementOf` in `rate-brief-log.tsx` labels the row "new lane" —
    // telling the room the network has never carried a lane it carries.
    await post({
      ...valid,
      laneRates: [{ lane: "SHA-LAX", mode: "ocean", newRateUsdPerKg: 0.52 }],
    });
    expect(store.rateBriefs()[0].laneRates[0].oldRateUsdPerKg).toBe(0.45);
  });

  it("settles a prior rate the model got WRONG", async () => {
    // Stored verbatim this renders "down 94.8%" beside a document printing
    // "$0.45 to $0.52, up 15.6%". The ledger owns this field, so it OVERWRITES
    // rather than merely filling a gap — a `??` would leave this case standing.
    await post({
      ...valid,
      laneRates: [
        {
          lane: "SHA-LAX",
          mode: "ocean",
          oldRateUsdPerKg: 9.99,
          newRateUsdPerKg: 0.52,
        },
      ],
    });
    expect(store.rateBriefs()[0].laneRates[0].oldRateUsdPerKg).toBe(0.45);
  });

  it("scopes the settlement to the CARRIER, not the whole network", async () => {
    // Northline moves nothing on SHA-LAX, so Meridian holds no rate with THEM on
    // it, even though the network carries that lane with another carrier. A rate
    // sheet is one carrier's quote, so this is the honest reading — and it is
    // also what makes the match unique, since SHA-LAX ocean is two lanes
    // network-wide.
    const res = await post({
      ...valid,
      carrier: "Northline",
      laneRates: [
        {
          lane: "SHA-LAX",
          mode: "ocean",
          oldRateUsdPerKg: 0.45,
          newRateUsdPerKg: 0.52,
        },
      ],
    });
    expect(store.rateBriefs()[0].laneRates[0].oldRateUsdPerKg).toBeUndefined();
    expect((await res.json()).noPriorRateOnFile).toEqual(["SHA-LAX"]);
  });

  it("leaves a genuinely ambiguous lane to the model, and says so", async () => {
    // Two lanes with the same code AND mode under ONE carrier: the app cannot
    // say which the sheet meant, so it must not pick. The seed has no such pair,
    // which is why this builds one — the branch is otherwise unreachable and
    // would rot silently. `store.reset()` in `beforeEach` restores both arrays.
    store.lanes().push({
      id: "ln-sha-lax-ocean-2nd",
      origin: "Shanghai (SHA)",
      destination: "Los Angeles (LAX)",
      mode: "ocean",
      transitDays: 26,
      reliability: 0.7,
      costPerKg: 0.99,
      status: "healthy",
    });
    store.shipments().push({
      ...store.shipments()[0],
      id: "shp-amb",
      reference: "PO-AMB",
      laneId: "ln-sha-lax-ocean-2nd",
      carrier: "Pacific Star Line",
    });

    const res = await post(valid);
    // Untouched — neither settled to one of the two nor stripped.
    expect(store.rateBriefs()[0].laneRates[0].oldRateUsdPerKg).toBe(0.45);
    expect((await res.json()).ambiguousLanes).toEqual(["SHA-LAX"]);
  });

  it("treats a prior rate of 0 as no prior rate", async () => {
    // A stored 0 reads three ways: the card treats `<= 0` as "new lane", the
    // readable emits `old_rate_usd_per_kg: 0`, and the agent then says
    // "$0.00 → $0.49" about a row labelled "new lane". One meaning, at the door.
    await post({
      ...valid,
      carrier: "Northline",
      laneRates: [
        {
          lane: "SHA-OAK",
          mode: "ocean",
          oldRateUsdPerKg: 0,
          newRateUsdPerKg: 0.49,
        },
      ],
    });
    expect(store.rateBriefs()[0].laneRates[0].oldRateUsdPerKg).toBeUndefined();
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
