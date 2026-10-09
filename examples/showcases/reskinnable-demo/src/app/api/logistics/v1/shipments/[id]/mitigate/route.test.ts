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
    {
      params: Promise.resolve({ id }),
    },
  );

describe("POST /shipments/:id/mitigate", () => {
  it("commits a mitigation within the planner's authority", async () => {
    const res = await call("shp-4821", {
      kind: "reroute",
      rationale: "Priority berthing at LAX.",
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(200);
    expect(store.findShipment("shp-4821")?.appliedMitigation?.kind).toBe(
      "reroute",
    );
  });

  it("blocks an over-authority expedite with 403 and does not mutate", async () => {
    const res = await call("shp-4821", {
      kind: "expedite",
      rationale: "Need it now.",
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("OVER_AUTHORITY");
    expect(body.message).toContain("$8,400");
    expect(store.findShipment("shp-4821")?.appliedMitigation).toBeUndefined();
  });

  it("IGNORES a client-supplied cost and recomputes server-side", async () => {
    const res = await call("shp-4821", {
      kind: "expedite",
      rationale: "x",
      plannerId: "pl-rosa",
      costUsd: 1,
    });
    expect(res.status).toBe(403); // the $1 the client sent must not be trusted
  });

  it("lets a Director commit the same expedite", async () => {
    const res = await call("shp-4821", {
      kind: "expedite",
      rationale: "Customer commit.",
      plannerId: "pl-ibrahim",
    });
    expect(res.status).toBe(200);
    expect(store.findShipment("shp-4821")?.appliedMitigation?.costUsd).toBe(
      8400,
    );
  });

  it("allows the expedite once a justifying escalation is approved", async () => {
    const draft = store.openEscalation(
      "shp-4821",
      "LINE_DOWN_RISK",
      "LA DC stops Thursday.",
    );
    store.approveEscalation(draft.id);
    const res = await call("shp-4821", {
      kind: "expedite",
      rationale: "Escalation approved.",
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(200);
  });

  it("still blocks after a NON-justifying escalation is approved", async () => {
    const draft = store.openEscalation(
      "shp-4821",
      "INTERNAL_CONVENIENCE",
      "Easier for the team.",
    );
    store.approveEscalation(draft.id);
    const res = await call("shp-4821", {
      kind: "expedite",
      rationale: "x",
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(403);
  });

  it("404s an unknown shipment and 422s an unavailable option kind", async () => {
    expect(
      (
        await call("nope", {
          kind: "absorb",
          rationale: "x",
          plannerId: "pl-rosa",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("shp-4821", {
          kind: "banana",
          rationale: "x",
          plannerId: "pl-rosa",
        })
      ).status,
    ).toBe(422);
  });

  it("400s a missing plannerId", async () => {
    expect(
      (await call("shp-4821", { kind: "absorb", rationale: "x" })).status,
    ).toBe(400);
  });

  it("files a decision record on every successful commit", async () => {
    await call("shp-4821", {
      kind: "absorb",
      rationale: "Cover holds.",
      plannerId: "pl-rosa",
    });
    expect(store.decisions()[0]).toMatchObject({
      shipmentId: "shp-4821",
      kind: "absorb",
      status: "committed",
    });
  });
});
