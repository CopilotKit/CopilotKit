/**
 * BEAT 6 — the two things about the SEEDED network that beat 6 cannot survive
 * without, asserted against `seed.json` itself rather than against a fixture.
 *
 * Its sibling `authority.test.ts` proves the GATE RULE — that an approved
 * justifying escalation lifts it, a draft or a decoy does not — over hand-built
 * fixtures, which is the right shape for a rule. Neither file subsumes the
 * other: a fixture cannot notice that the real network has stopped offering the
 * demo a case to run on, and a seed assertion cannot enumerate the rule's edges.
 *
 * 1. There is MORE THAN ONE gated case. The case taught on stage is released by
 *    the demonstration, so a single gated shipment leaves nothing to replay on
 *    and the payoff — "now watch it do a different one unaided" — has no
 *    subject. A fixture cannot notice that; only the real seed can.
 * 2. The figures the beat-6 suggestion pill's comment states are the figures the
 *    demo actually produces. Those numbers are load-bearing (the pill asks for
 *    the one option Rosa may NOT commit, and beat 3a asks for one she may), and
 *    the only thing that has ever kept such a comment honest in this app is a
 *    test that re-derives it.
 *
 * `computeMitigationOptions` is the same pure function the mitigate route
 * recomputes with, so these assertions describe the gate the server enforces and
 * not a client-side guess.
 */
import { describe, expect, it } from "vitest";
import seed from "./seed.json";
import { blockedByAuthority, checkAuthority } from "./authority";
import { ESCALATION_CODES } from "./escalation-codes";
import { computeMitigationOptions } from "./mitigation-options";
import type { Lane, Planner, Shipment } from "./types";

const lanes = seed.lanes as Lane[];
const shipments = seed.shipments as Shipment[];
const planners = seed.planners as Planner[];

const rosa = planners.find((p) => p.id === "pl-rosa")!;
const ibrahim = planners.find((p) => p.id === "pl-ibrahim")!;

const byReference = (reference: string) =>
  shipments.find((s) => s.reference === reference)!;

describe("logistics beat 6 — the seeded authority gate", () => {
  it("gives the bounded planner TWO gated shipments, not one", () => {
    // The whole beat needs a second case: the first is released by the
    // demonstration itself. If this drops to one, beat 6 loses its payoff and
    // the suggestion pills need re-planning — which is why the failure message
    // says so rather than just printing a number.
    const cases = blockedByAuthority(shipments, lanes, rosa.authorityUsd);
    expect(
      cases.map((c) => c.shipment.reference).sort(),
      "beat 6 needs at least two over-authority shipments: one to teach on, a DIFFERENT one to replay on",
    ).toEqual(["PO-88213", "PO-88281"]);
  });

  it("gates exactly the expedites the beat-6 and replay pills name", () => {
    const cases = blockedByAuthority(shipments, lanes, rosa.authorityUsd);
    const taught = cases.find((c) => c.shipment.reference === "PO-88213")!;
    const replay = cases.find((c) => c.shipment.reference === "PO-88281")!;

    expect(rosa.authorityUsd).toBe(5000);
    expect(taught.option.kind).toBe("expedite");
    expect(taught.option.costUsd).toBe(8400);
    expect(replay.option.kind).toBe("expedite");
    expect(replay.option.costUsd).toBe(5640);
  });

  it("leaves beat 3a's release UNDER the same planner's authority", () => {
    // Beat 3a asks for the reroute on PO-88213 and beat 6 asks for the expedite
    // on the same shipment. They are only distinguishable on stage because one
    // is inside Rosa's authority and the other is not — if that ever stopped
    // being true the PIN card would become a second door past the beat-6 gate.
    const options = computeMitigationOptions(byReference("PO-88213"), lanes);
    const reroute = options.find((o) => o.kind === "reroute")!;
    const split = options.find((o) => o.kind === "split")!;
    expect(reroute.costUsd).toBe(572);
    expect(split.costUsd).toBe(4350);
    for (const option of [reroute, split]) {
      expect(option.costUsd).toBeLessThanOrEqual(rosa.authorityUsd!);
    }
  });

  it("gates nothing for a Director", () => {
    expect(ibrahim.authorityUsd).toBeNull();
    expect(blockedByAuthority(shipments, lanes, ibrahim.authorityUsd)).toEqual(
      [],
    );
  });

  it("drops a shipment once a mitigation has been applied to it", () => {
    // Otherwise the case taught on stage stays on the filing form afterwards and
    // invites a second demonstration of a procedure already demonstrated.
    const released: Shipment[] = shipments.map((s) =>
      s.reference === "PO-88213"
        ? {
            ...s,
            appliedMitigation: {
              kind: "expedite",
              costUsd: 8400,
              decidedAt: "2026-08-01T00:00:00Z",
            },
          }
        : s,
    );
    expect(
      blockedByAuthority(released, lanes, rosa.authorityUsd).map(
        (c) => c.shipment.reference,
      ),
    ).toEqual(["PO-88281"]);
  });

  it("refuses the gated expedite naming the symptom and never the fix", () => {
    // The 403 body is the FIFTH leak channel. It may name the cost and the cap;
    // it must not name a code, the catalogue, or which codes justify.
    //
    // `authority.test.ts` checks that message too, against one hand-picked code.
    // This one sweeps the WHOLE catalogue — adding a seventh code there would
    // otherwise arrive unwatched — and does it with the figures the demo really
    // produces rather than with numbers typed into a fixture.
    const shipment = byReference("PO-88213");
    const option = computeMitigationOptions(shipment, lanes).find(
      (o) => o.kind === "expedite",
    )!;
    const verdict = checkAuthority({
      costUsd: option.costUsd,
      planner: rosa,
      shipment,
      escalations: [],
    });
    expect(verdict.allowed).toBe(false);
    const message = verdict.allowed ? "" : verdict.message;
    // PRESENCE of the symptom, not merely absence of the fix — an empty message
    // would satisfy the absence assertions on its own.
    expect(message).toContain("$8,400");
    expect(message).toContain("$5,000");
    for (const code of ESCALATION_CODES) {
      expect(message, `the refusal names ${code}`).not.toContain(code);
    }
    expect(message).not.toMatch(/catalogue|valid codes/i);
  });
});
