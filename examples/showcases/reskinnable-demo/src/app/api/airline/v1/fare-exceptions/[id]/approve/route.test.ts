import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/airline/data/store";

beforeEach(() => store.reset());

const call = (id: string) =>
  POST(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

const file = (bookingId: string, code: string) => {
  const booking = store.findBooking(bookingId);
  if (!booking) throw new Error(`no booking ${bookingId}`);
  const filed = store.fileException(booking, code, "notice AV-88214", "");
  if (!filed.ok) throw new Error(`could not file ${code}`);
  return filed.exception;
};

describe("POST /fare-exceptions/[id]/approve — beat 6, unlock step 2", () => {
  it("approves and links the exception to its booking", async () => {
    const exception = file("bkg-av2214", "SCHEDULE_CHANGE_TRIGGERED");
    const res = await call(exception.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exception.status).toBe("approved");
    expect(body.booking.activeExceptionId).toBe(exception.id);
  });

  it("links a DECOY just the same — linking is not lifting", async () => {
    // The passenger watches a perfectly successful filing change nothing at all.
    // That is what makes the decoys real rather than theoretical.
    const exception = file("bkg-av2214", "ELITE_COURTESY");
    const res = await call(exception.id);
    expect(res.status).toBe(200);
    expect(store.findBooking("bkg-av2214")?.activeExceptionId).toBe(
      exception.id,
    );
  });

  it("responds IDENTICALLY in shape whether or not the gate moved", async () => {
    // A `lifts` flag here would turn this endpoint into a catalogue oracle.
    const justifying = await call(
      file("bkg-av2214", "SCHEDULE_CHANGE_TRIGGERED").id,
    );
    store.reset();
    const decoy = await call(file("bkg-av2214", "CHANGED_PLANS").id);

    expect(justifying.status).toBe(decoy.status);
    const a = await justifying.json();
    const b = await decoy.json();
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(Object.keys(a.exception).sort()).toEqual(
      Object.keys(b.exception).sort(),
    );
    for (const body of [a, b]) {
      const text = JSON.stringify(body).toLowerCase();
      expect(text).not.toContain("lift");
      expect(text).not.toContain("justif");
      expect(text).not.toContain("waiverground");
    }
  });

  it("404s an unknown exception and 409s a second approval", async () => {
    expect((await call("fex-nope")).status).toBe(404);
    const exception = file("bkg-av1188", "FOUND_LOWER_FARE");
    expect((await call(exception.id)).status).toBe(200);
    const again = await call(exception.id);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("ALREADY_APPROVED");
  });
});
