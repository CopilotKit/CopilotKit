import { describe, it, expect, beforeEach } from "vitest";
import { PATCH } from "./route";
import { POST as MITIGATE } from "./mitigate/route";
import * as store from "@/skins/logistics/data/store";

beforeEach(() => store.reset());

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request("http://localhost/x", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({ id }),
    },
  );

const mitigate = (id: string, body: unknown) =>
  MITIGATE(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({ id }),
    },
  );

describe("PATCH /shipments/:id", () => {
  it("patches status", async () => {
    const res = await patch("shp-4821", { status: "resolved" });
    expect(res.status).toBe(200);
    expect(store.findShipment("shp-4821")?.status).toBe("resolved");
  });

  it("patches etaCurrent", async () => {
    const res = await patch("shp-4821", { etaCurrent: "2026-08-09" });
    expect(res.status).toBe(200);
    expect(store.findShipment("shp-4821")?.etaCurrent).toBe("2026-08-09");
  });

  it("rejects weightKg with 422 and does not write", async () => {
    const res = await patch("shp-4821", { weightKg: 1 });
    expect(res.status).toBe(422);
    expect(store.findShipment("shp-4821")?.weightKg).toBe(1400);
  });

  it("rejects laneId with 422 and does not write", async () => {
    const res = await patch("shp-4821", { laneId: "ln-sha-lax-air" });
    expect(res.status).toBe(422);
    expect(store.findShipment("shp-4821")?.laneId).toBe("ln-sha-lax-ocean");
  });

  it("rejects a present-but-null gated field (presence-based)", async () => {
    const res = await patch("shp-4821", { appliedMitigation: null });
    expect(res.status).toBe(422);
  });

  it("cannot lower expedite cost under the authority limit by patching weightKg", async () => {
    const patched = await patch("shp-4821", { weightKg: 1 });
    expect(patched.status).toBe(422);

    const res = await mitigate("shp-4821", {
      kind: "expedite",
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(403);
    expect(store.findShipment("shp-4821")?.appliedMitigation).toBeUndefined();
  });

  it("404s an unknown shipment", async () => {
    const res = await patch("nope", { status: "resolved" });
    expect(res.status).toBe(404);
  });
});
