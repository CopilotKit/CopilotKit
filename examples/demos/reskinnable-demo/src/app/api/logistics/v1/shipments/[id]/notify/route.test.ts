import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/logistics/data/store";

beforeEach(() => store.reset());

const call = (id: string, body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("POST /shipments/[id]/notify", () => {
  it("records the notice against the shipment's OWN carrier", async () => {
    const res = await call("shp-4823", {
      template: "recovery-plan",
      plannerId: "pl-rosa",
      // Both decoys the server must ignore. The carrier especially: the sentence
      // the agent reads aloud names it, and a model-spelled carrier is how the
      // demo ends up chasing a company that is not carrying the freight.
      carrier: "Somebody Else Line",
      sentBy: "Mallory",
    });
    expect(res.status).toBe(201);
    expect(store.findShipment("shp-4823")?.carrierNotices?.[0]).toMatchObject({
      template: "recovery-plan",
      carrier: "Norte Freight",
      sentBy: "Rosa Delgado",
    });
  });

  it("422s a template outside the closed set", async () => {
    const res = await call("shp-4823", {
      template: "strongly-worded-letter",
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: "INVALID_CARRIER_MESSAGE",
    });
    expect(store.findShipment("shp-4823")?.carrierNotices).toBeUndefined();
  });

  it("404s an unknown shipment and 400s an unknown planner", async () => {
    expect(
      (
        await call("shp-nope", {
          template: "recovery-plan",
          plannerId: "pl-rosa",
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("shp-4823", { template: "recovery-plan", plannerId: "who" }))
        .status,
    ).toBe(400);
  });
});
