import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/logistics/data/store";
import { NOTE_MARKER } from "@/skins/logistics/data/handling";

beforeEach(() => store.reset());

const call = (id: string, body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("POST /shipments/[id]/notes", () => {
  it("forces the marker and takes the author from the PLANNER", async () => {
    // The marker is the affordance: "if the audience can't see the change, it
    // didn't happen". It is applied server-side so no caller can phrase its way
    // out of it.
    const res = await call("shp-4823", {
      text: "Carrier silent since Friday.",
      plannerId: "pl-rosa",
      author: "Mallory",
    });
    expect(res.status).toBe(201);
    const note = store.findShipment("shp-4823")?.notes?.[0];
    expect(note?.text).toBe(`${NOTE_MARKER} Carrier silent since Friday.`);
    expect(note?.author).toBe("Rosa Delgado");
  });

  it("422s an empty note rather than filing a marker with nothing after it", async () => {
    const res = await call("shp-4823", { text: "   ", plannerId: "pl-rosa" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "EMPTY_NOTE" });
    expect(store.findShipment("shp-4823")?.notes).toBeUndefined();
  });

  it("404s an unknown shipment and 400s an unknown planner", async () => {
    expect(
      (await call("shp-nope", { text: "x", plannerId: "pl-rosa" })).status,
    ).toBe(404);
    expect(
      (await call("shp-4823", { text: "x", plannerId: "who" })).status,
    ).toBe(400);
  });
});
