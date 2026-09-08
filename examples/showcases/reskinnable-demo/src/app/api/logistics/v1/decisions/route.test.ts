import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/logistics/data/store";

beforeEach(() => store.reset());

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

describe("POST /decisions", () => {
  it("records a decision with decidedBy/role from the PLANNER, not the body", async () => {
    const res = await call({
      shipmentId: "shp-4821",
      kind: "escalation",
      rationale: "Ops accepted the recommendation verbally.",
      plannerId: "pl-rosa",
      // Decoys the server must ignore — never trust decidedBy/role from a client.
      decidedBy: "Mallory",
      role: "Director",
    });
    expect(res.status).toBe(201);
    const decision = store.decisions()[0];
    expect(decision).toMatchObject({
      shipmentId: "shp-4821",
      kind: "escalation",
      decidedBy: "Rosa Delgado",
      role: "Planner",
      status: "committed",
    });
    expect(decision.decidedBy).not.toBe("Mallory");
    expect(decision.role).not.toBe("Director");
  });

  it("404s an unknown shipmentId", async () => {
    const res = await call({
      shipmentId: "nope",
      kind: "reroute",
      rationale: "x",
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(404);
  });

  it("400s a missing plannerId", async () => {
    const res = await call({
      shipmentId: "shp-4821",
      kind: "reroute",
      rationale: "x",
    });
    expect(res.status).toBe(400);
  });
});
