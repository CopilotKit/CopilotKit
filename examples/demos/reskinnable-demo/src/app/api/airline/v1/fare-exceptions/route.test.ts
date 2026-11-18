import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/airline/data/store";
import { FARE_WAIVER_CODES } from "@/skins/airline/data/fare-waiver-codes";

beforeEach(() => store.reset());

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

describe("POST /fare-exceptions — beat 6, unlock step 1", () => {
  it("files every catalogued category, decoys included, exactly as entered", async () => {
    // A record that quietly corrected the passenger would report a procedure
    // nobody demonstrated, and the refusal they then watch stay in place is the
    // demonstration working, not failing.
    for (const code of FARE_WAIVER_CODES) {
      store.reset();
      const res = await call({
        booking: "bkg-av2214",
        code,
        documentReference: "notice AV-88214",
        rationale: "The airline moved the flight.",
      });
      expect(res.status).toBe(201);
      expect((await res.json()).exception.code).toBe(code);
    }
  });

  it("REFUSES an uncatalogued code WITHOUT enumerating the valid set", async () => {
    // A 4xx body is one of the five channels that leak a gate's vocabulary, and
    // "valid codes are X, Y, Z" is the reflex every other route in this app
    // follows. Here it is the defect.
    const res = await call({
      booking: "bkg-av2214",
      code: "SCHEDULE_CHANGE",
      documentReference: "notice AV-88214",
    });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("INVALID_EXCEPTION_CODE");
    for (const code of FARE_WAIVER_CODES) expect(text).not.toContain(code);
    expect(store.exceptions()).toEqual([]);
  });

  it("refuses a filing with no documentation behind it", async () => {
    const res = await call({
      booking: "bkg-av2214",
      code: "SCHEDULE_CHANGE_TRIGGERED",
      documentReference: "   ",
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("MISSING_DOCUMENTATION");
  });

  it("NEVER says whether the exception will lift anything", async () => {
    // A `lifts` flag would hand over the whole withheld catalogue one probe at a
    // time: file, read the flag, discard, repeat. The only way to find out is to
    // retry the change.
    const justifying = await call({
      booking: "bkg-av2214",
      code: "SCHEDULE_CHANGE_TRIGGERED",
      documentReference: "notice AV-88214",
    });
    store.reset();
    const decoy = await call({
      booking: "bkg-av2214",
      code: "ELITE_COURTESY",
      documentReference: "membership AN-5518844",
    });

    const justifyingBody = await justifying.json();
    const decoyBody = await decoy.json();
    expect(justifying.status).toBe(decoy.status);
    // Field for field, the two receipts differ ONLY in what the passenger typed.
    expect(Object.keys(justifyingBody.exception).sort()).toEqual(
      Object.keys(decoyBody.exception).sort(),
    );
    for (const body of [justifyingBody, decoyBody]) {
      expect(JSON.stringify(body).toLowerCase()).not.toContain("lift");
      expect(JSON.stringify(body).toLowerCase()).not.toContain("justif");
      expect(JSON.stringify(body).toLowerCase()).not.toContain("ground");
    }
  });

  it("400s a bad body, 404s an unknown booking, 409s an ambiguous PNR", async () => {
    const bad = await POST(
      new Request("http://localhost/x", { method: "POST", body: "nope" }),
    );
    expect(bad.status).toBe(400);
    expect(
      (
        await call({
          booking: "nope",
          code: "MILITARY_ORDERS",
          documentReference: "orders",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call({
          booking: "AV7QK2",
          code: "MILITARY_ORDERS",
          documentReference: "orders",
        })
      ).status,
    ).toBe(409);
  });
});
