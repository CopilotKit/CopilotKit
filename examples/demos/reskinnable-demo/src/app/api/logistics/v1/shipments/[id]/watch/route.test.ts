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

describe("POST /shipments/[id]/watch", () => {
  it("raises the flag with raisedBy from the PLANNER, not the body", async () => {
    const res = await call("shp-4823", {
      reason: "carrier-silent",
      plannerId: "pl-rosa",
      // A decoy the server must ignore: who raised the flag is part of the audit
      // trail, and a client that could set it would be forging one.
      raisedBy: "Mallory",
    });
    expect(res.status).toBe(201);
    expect(store.findShipment("shp-4823")?.watch).toMatchObject({
      reason: "carrier-silent",
      raisedBy: "Rosa Delgado",
    });
  });

  it("422s a reason outside the closed set, and names the valid shape", async () => {
    const res = await call("shp-4823", {
      reason: "vibes",
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "INVALID_WATCH_REASON" });
    expect(store.findShipment("shp-4823")?.watch).toBeUndefined();
  });

  it("404s an unknown shipment and 400s an unknown planner", async () => {
    expect(
      (
        await call("shp-nope", {
          reason: "carrier-silent",
          plannerId: "pl-rosa",
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("shp-4823", { reason: "carrier-silent", plannerId: "who" }))
        .status,
    ).toBe(400);
    expect((await call("shp-4823", { reason: "carrier-silent" })).status).toBe(
      400,
    );
  });
});
