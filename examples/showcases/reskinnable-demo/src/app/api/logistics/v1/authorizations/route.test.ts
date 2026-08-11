import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/logistics/data/store";
import { computeMitigationOptions } from "@/skins/logistics/data/mitigation-options";
import type { MitigationOption } from "@/skins/logistics/data/types";

beforeEach(() => store.reset());

/** A PIN that `readPlannerPin` accepts — six digits, nothing else. */
const VALID_PIN = "482913";

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

/**
 * The cases are DISCOVERED from the live mitigation costs rather than
 * hardcoded. logistics' own gate script asserted against `absorb` in its first
 * draft — which always costs $0 and can therefore never be over authority, so
 * it would have "passed" a gate it never exercised. These helpers THROW rather
 * than merely asserting, so a seed change that removes the case fails loudly
 * here instead of quietly turning an assertion vacuous.
 */
const rosaAuthority = (): number => {
  const planner = store.planners().find((p) => p.id === "pl-rosa");
  if (!planner || planner.authorityUsd === null) {
    throw new Error("Rosa must be a bounded-authority planner for these tests");
  }
  return planner.authorityUsd;
};

const optionsFor = (id: string): MitigationOption[] => {
  const shipment = store.findShipment(id);
  if (!shipment) throw new Error(`no shipment ${id}`);
  return computeMitigationOptions(shipment, store.lanes());
};

/** The cheapest option Rosa may ALREADY commit — the card's own choice rule. */
const underAuthorityOption = (id: string): MitigationOption => {
  const cap = rosaAuthority();
  const option = optionsFor(id)
    .filter((o) => o.costUsd > 0 && o.costUsd <= cap)
    .sort((a, b) => a.costUsd - b.costUsd)[0];
  if (!option) throw new Error(`no under-authority option on ${id}`);
  return option;
};

const overAuthorityOption = (id: string): MitigationOption => {
  const cap = rosaAuthority();
  const option = optionsFor(id).find((o) => o.costUsd > cap);
  if (!option) throw new Error(`no over-authority option on ${id}`);
  return option;
};

describe("POST /authorizations", () => {
  it("releases the cheapest under-authority option and mutates the shipment", async () => {
    const option = underAuthorityOption("shp-4821");
    const res = await call({
      shipment: "PO-88213",
      kind: option.kind,
      pin: VALID_PIN,
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(200);
    expect(store.findShipment("shp-4821")?.appliedMitigation).toMatchObject({
      kind: option.kind,
      costUsd: option.costUsd,
    });
    expect(store.decisions()[0]).toMatchObject({
      shipmentId: "shp-4821",
      kind: option.kind,
      status: "committed",
    });
  });

  // ── THE SEPARATION. This is the whole reason this route has a test. ───────
  //
  // A PIN is a SECOND FACTOR on a spend the planner may already make — it says
  // WHO is acting, never HOW MUCH they may commit. If a valid PIN released an
  // over-authority cost it would be a second unlock path around beat 6's
  // escalation gate: the agent would route around the gate it exists to teach,
  // the teach arc would never fire, and nothing anywhere would fail. This
  // assertion is the only symptom that failure has.
  it("REFUSES a valid PIN on an over-authority option with the AUTHORITY error", async () => {
    const option = overAuthorityOption("shp-4821");
    const res = await call({
      shipment: "PO-88213",
      kind: option.kind,
      pin: VALID_PIN,
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("OVER_AUTHORITY");
    // Nothing was written: the PIN did not buy a partial pass either.
    expect(store.findShipment("shp-4821")?.appliedMitigation).toBeUndefined();
    expect(store.decisions()).toHaveLength(0);
  });

  it("still lets a justifying escalation — not a PIN — lift that same block", async () => {
    const option = overAuthorityOption("shp-4821");
    const draft = store.openEscalation(
      "shp-4821",
      "LINE_DOWN_RISK",
      "LA DC stops Thursday.",
    );
    store.approveEscalation(draft.id);

    const res = await call({
      shipment: "PO-88213",
      kind: option.kind,
      pin: VALID_PIN,
      plannerId: "pl-rosa",
    });
    expect(res.status).toBe(200);
  });

  it("refuses a malformed PIN with 401 and writes nothing", async () => {
    const option = underAuthorityOption("shp-4821");
    for (const pin of ["", "4829", "-482913", "48291a", undefined]) {
      const res = await call({
        shipment: "PO-88213",
        kind: option.kind,
        pin,
        plannerId: "pl-rosa",
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("INVALID_PIN");
    }
    expect(store.findShipment("shp-4821")?.appliedMitigation).toBeUndefined();
  });

  it("never echoes the typed PIN back in any response body", async () => {
    const under = underAuthorityOption("shp-4821");
    const over = overAuthorityOption("shp-4821");
    const cases = [
      { shipment: "PO-88213", kind: over.kind, pin: VALID_PIN },
      { shipment: "PO-88213", kind: under.kind, pin: "4829" },
      { shipment: "nope", kind: under.kind, pin: VALID_PIN },
      { shipment: "PO-88213", kind: under.kind, pin: VALID_PIN },
    ];
    for (const body of cases) {
      const text = await (await call({ ...body, plannerId: "pl-rosa" })).text();
      // "4829" is also VALID_PIN's prefix, so this covers both typed values.
      expect(text).not.toContain("4829");
    }
  });

  it("400s a missing planner, 404s an unknown shipment, 422s an unavailable kind", async () => {
    expect(
      (await call({ shipment: "PO-88213", kind: "reroute", pin: VALID_PIN }))
        .status,
    ).toBe(400);
    expect(
      (
        await call({
          shipment: "nope",
          kind: "reroute",
          pin: VALID_PIN,
          plannerId: "pl-rosa",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call({
          shipment: "PO-88213",
          kind: "banana",
          pin: VALID_PIN,
          plannerId: "pl-rosa",
        })
      ).status,
    ).toBe(422);
  });
});
