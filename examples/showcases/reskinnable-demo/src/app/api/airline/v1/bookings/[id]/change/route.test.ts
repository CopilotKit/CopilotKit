import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/airline/data/store";
import { FARE_WAIVER_CODES } from "@/skins/airline/data/fare-waiver-codes";
import { optionsForBooking } from "@/skins/airline/data/rebooking-options";

beforeEach(() => store.reset());

const call = (id: string, body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const booking = (id: string) => {
  const found = store.findBooking(id);
  if (!found) throw new Error(`no booking ${id}`);
  return found;
};

const freeOption = (bookingId: string) => {
  const option = optionsForBooking(store.options(), bookingId).find(
    (o) => o.fareDifferenceUsd === 0,
  );
  if (!option) throw new Error(`no free option on ${bookingId}`);
  return option;
};

describe("BEAT 5 — the involuntary rebooking", () => {
  it("reissues a cancelled flight free of charge, on whatever fare", async () => {
    const option = freeOption("bkg-av1466");
    const res = await call("bkg-av1466", { optionId: option.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permission).toBe("involuntary");
    expect(body.amountPaidUsd).toBe(0);
    expect(body.reissue.flightNumber).toBe(option.flightNumber);
    expect(booking("bkg-av1466").status).toBe("changed");
  });

  it("refuses a second reissue on the same record", async () => {
    const option = freeOption("bkg-av1466");
    await call("bkg-av1466", { optionId: option.id });
    const res = await call("bkg-av1466", { optionId: option.id });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALREADY_CHANGED");
  });
});

describe("BEAT 6 — the gate", () => {
  it("REFUSES a Basic Economy ticket, naming the fare condition", async () => {
    const option = freeOption("bkg-av2214");
    const res = await call("bkg-av2214", { optionId: option.id });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("FARE_NOT_CHANGEABLE");
    expect(body.message).toContain("Basic Economy");
    expect(booking("bkg-av2214").status).toBe("ticketed");
  });

  it("never names the way through in the refusal body", async () => {
    // A 4xx body is one of the five channels that leak a gate's vocabulary. The
    // PRESENCE of the symptom is asserted above; this is the absence half, and
    // both are needed — an empty message satisfies "names no category".
    const body = await (
      await call("bkg-av2214", { optionId: freeOption("bkg-av2214").id })
    ).text();
    for (const code of FARE_WAIVER_CODES) expect(body).not.toContain(code);
    const lowered = body.toLowerCase();
    for (const leak of ["exception", "waiver", "categor", "certificate"]) {
      expect(lowered).not.toContain(leak);
    }
  });

  it("refuses EVERY option on a refused fare, not just the cheap one", async () => {
    // The gate is a property of the FARE, not of an amount, so no choice of
    // option can slip past it. Walked from the live ledger rather than
    // hardcoded, so a reseed cannot make this vacuous.
    const options = optionsForBooking(store.options(), "bkg-av0918");
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) {
      const res = await call("bkg-av0918", { optionId: option.id });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("FARE_NOT_CHANGEABLE");
    }
  });

  it("lets a GROUNDED, approved exception through", async () => {
    const filed = store.fileException(
      booking("bkg-av2214"),
      "SCHEDULE_CHANGE_TRIGGERED",
      "notice AV-88214",
      "",
    );
    if (!filed.ok) throw new Error("could not file");
    store.approveException(filed.exception.id);

    const res = await call("bkg-av2214", {
      optionId: freeOption("bkg-av2214").id,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).permission).toBe("exception");
  });

  it("still refuses under a DECOY, though the exception is approved", async () => {
    for (const code of [
      "CHANGED_PLANS",
      "FOUND_LOWER_FARE",
      "ELITE_COURTESY",
    ]) {
      store.reset();
      const filed = store.fileException(
        booking("bkg-av2214"),
        code,
        "email 2 Jul",
        "",
      );
      if (!filed.ok) throw new Error(`could not file ${code}`);
      store.approveException(filed.exception.id);
      const res = await call("bkg-av2214", {
        optionId: freeOption("bkg-av2214").id,
      });
      expect(res.status).toBe(422);
    }
  });

  it("refuses the booking NO category can release, under every category", async () => {
    for (const code of FARE_WAIVER_CODES) {
      store.reset();
      const filed = store.fileException(
        booking("bkg-av1188"),
        code,
        "email 4 Aug",
        "",
      );
      if (!filed.ok) throw new Error(`could not file ${code}`);
      store.approveException(filed.exception.id);
      const res = await call("bkg-av1188", {
        optionId: freeOption("bkg-av1188").id,
      });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("FARE_NOT_CHANGEABLE");
    }
  });
});

describe("the fare check runs BEFORE the money check", () => {
  it("refuses a non-changeable ticket with the FARE error, not a bill", async () => {
    // If the order flipped, the gate's symptom would be a payment prompt and the
    // passenger would learn to reach for their card instead of the procedure.
    const paid = optionsForBooking(store.options(), "bkg-av2214").find(
      (o) => o.fareDifferenceUsd > 0,
    );
    if (!paid) throw new Error("seed has no paid option on bkg-av2214");
    const res = await call("bkg-av2214", { optionId: paid.id });
    expect((await res.json()).error).toBe("FARE_NOT_CHANGEABLE");
  });
});

describe("this route will not take money", () => {
  it("402s when something is due, and commits nothing", async () => {
    // `POST /authorizations` is the only path that commits a paid change,
    // because that is where the card confirmation arrives. If this route could
    // do it too, beat 3a's card would be decoration.
    const paid = optionsForBooking(store.options(), "bkg-av7702").find(
      (o) => o.fareDifferenceUsd > 0,
    );
    if (!paid) throw new Error("seed has no paid option on bkg-av7702");
    const res = await call("bkg-av7702", { optionId: paid.id });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("PAYMENT_REQUIRED");
    expect(body.amountDueUsd).toBe(paid.fareDifferenceUsd);
    expect(booking("bkg-av7702").status).toBe("ticketed");
  });

  it("ignores a client-supplied amount entirely", async () => {
    const paid = optionsForBooking(store.options(), "bkg-av7702").find(
      (o) => o.fareDifferenceUsd > 0,
    );
    if (!paid) throw new Error("seed has no paid option");
    const res = await call("bkg-av7702", {
      optionId: paid.id,
      amountDueUsd: 0,
      fareDifferenceUsd: 0,
      changeFeeUsd: 0,
    });
    expect(res.status).toBe(402);
    expect((await res.json()).amountDueUsd).toBe(paid.fareDifferenceUsd);
  });
});

describe("request hygiene", () => {
  it("400s a body that is not a JSON object", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: "nope" }),
      { params: Promise.resolve({ id: "bkg-av1466" }) },
    );
    expect(res.status).toBe(400);
  });

  it("422s an option that belongs to another booking", async () => {
    const res = await call("bkg-av1466", { optionId: "o-7702-a" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("UNAVAILABLE_OPTION");
  });

  it("404s an unknown booking and 409s an ambiguous PNR", async () => {
    expect((await call("nope", { optionId: "x" })).status).toBe(404);
    expect((await call("AV7QK2", { optionId: "x" })).status).toBe(409);
  });
});
