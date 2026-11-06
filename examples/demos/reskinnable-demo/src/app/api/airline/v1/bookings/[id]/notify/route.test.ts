import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/airline/data/store";
import {
  NOTE_MARKER,
  NOTICE_TEMPLATES,
  NOTIFY_PARTIES,
} from "@/skins/airline/data/handling";

beforeEach(() => store.reset());

const call = (id: string, body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("POST /bookings/[id]/notify — beat 5, step 3", () => {
  it("takes the contact off the BOOKING, not from the caller", async () => {
    // A client-supplied name is a name the model spelled, and this record is the
    // app claiming it told a specific person.
    const res = await call("bkg-av1466", {
      party: "arrival-pickup",
      template: "new-arrival-time",
      sentTo: "Somebody Else",
      channel: "carrier pigeon",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.notice.sentTo).toBe("Diego Rojas");
    expect(body.notice.channel).toBe("sms");
  });

  it("forces the marker onto the trip log", async () => {
    // "If the audience can't see the change, it didn't happen."
    await call("bkg-av1466", {
      party: "travel-companion",
      template: "delay-advisory",
    });
    expect(
      store.findBooking("bkg-av1466")?.log[0].text.startsWith(NOTE_MARKER),
    ).toBe(true);
  });

  it("REFUSES a party the booking cannot reach", async () => {
    // Aeronova must never claim to have told someone it has no contact for.
    const res = await call("bkg-av1466", {
      party: "hotel",
      template: "room-hold-request",
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("NO_CONTACT_ON_FILE");
    expect(store.findBooking("bkg-av1466")?.notices).toEqual([]);
  });

  it("enumerates both vocabularies in its refusals — they are GIVEN", async () => {
    const party = await call("bkg-av1466", {
      party: "landlord",
      template: "delay-advisory",
    });
    const partyMessage = (await party.json()).message;
    for (const value of NOTIFY_PARTIES) expect(partyMessage).toContain(value);

    const template = await call("bkg-av1466", {
      party: "arrival-pickup",
      template: "shout",
    });
    const templateMessage = (await template.json()).message;
    for (const value of NOTICE_TEMPLATES) {
      expect(templateMessage).toContain(value);
    }
  });

  it("400s a bad body, 404s an unknown booking, 409s an ambiguous PNR", async () => {
    const bad = await POST(
      new Request("http://localhost/x", { method: "POST", body: "nope" }),
      { params: Promise.resolve({ id: "bkg-av1466" }) },
    );
    expect(bad.status).toBe(400);
    const args = { party: "arrival-pickup", template: "delay-advisory" };
    expect((await call("nope", args)).status).toBe(404);
    expect((await call("AV7QK2", args)).status).toBe(409);
  });
});
