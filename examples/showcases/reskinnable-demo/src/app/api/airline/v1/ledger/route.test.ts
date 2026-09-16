import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/airline/data/store";

beforeEach(() => store.reset());

describe("GET /ledger", () => {
  it("returns the whole profile in one read", () => {
    // One snapshot rather than N endpoints: beat 3b asks the agent to describe
    // exactly what the user can see, and two panels fetching separately are two
    // chances to disagree.
    return GET().then(async (res) => {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual([
        "bookings",
        "briefs",
        "exceptions",
        "flights",
        "now",
        "options",
        "profile",
        "travelers",
      ]);
      expect(body.bookings).toHaveLength(7);
      expect(body.travelers).toHaveLength(3);
      expect(body.options.length).toBeGreaterThan(40);
    });
  });

  it("NEVER publishes the gate's ground", async () => {
    // A code-shaped token on the wire is a sixth leak channel for beat 6's
    // withheld vocabulary. See `store.toDto`.
    const body = await (await GET()).text();
    expect(body).not.toContain("waiverGround");
    expect(body).not.toContain("schedule_change");
    expect(body).not.toContain("bereavement");
  });

  it("publishes no card digits anywhere", async () => {
    // Beat 3a's secret must not exist anywhere the ledger can be read from.
    const body = await (await GET()).json();
    expect(body.profile.paymentCardLabel).not.toMatch(/[0-9]/);
  });

  it("reflects a write immediately", async () => {
    const booking = store.findBooking("bkg-av1466");
    if (!booking) throw new Error("missing booking");
    store.notifyParty(booking, "arrival-pickup", "new-arrival-time");
    const body = await (await GET()).json();
    const published = body.bookings.find(
      (b: { id: string }) => b.id === "bkg-av1466",
    );
    expect(published.notices).toHaveLength(1);
  });
});
