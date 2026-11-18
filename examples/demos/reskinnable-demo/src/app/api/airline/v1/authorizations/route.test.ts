import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/airline/data/store";
import { optionsForBooking } from "@/skins/airline/data/rebooking-options";

beforeEach(() => store.reset());

const VALID_CARD = "4417";

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const booking = (id: string) => {
  const found = store.findBooking(id);
  if (!found) throw new Error(`no booking ${id}`);
  return found;
};

const paidOption = (bookingId: string) => {
  const option = optionsForBooking(store.options(), bookingId).find(
    (o) => o.fareDifferenceUsd > 0,
  );
  if (!option) throw new Error(`no paid option on ${bookingId}`);
  return option;
};

describe("BEAT 3a — the card-confirmed paid change", () => {
  it("commits a permitted paid change and recomputes the amount itself", async () => {
    const option = paidOption("bkg-av7702");
    const res = await call({
      booking: "bkg-av7702",
      optionId: option.id,
      cardLast4: VALID_CARD,
      // Deliberately lying about the price. It must be ignored outright.
      amountDueUsd: 1,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Flex charges no change fee, so the amount due IS the fare difference.
    expect(body.amountPaidUsd).toBe(option.fareDifferenceUsd);
    expect(booking("bkg-av7702").status).toBe("changed");
  });

  it("never echoes what was typed, in any response", async () => {
    const responses = await Promise.all([
      call({ booking: "bkg-av7702", optionId: "x", cardLast4: VALID_CARD }),
      call({ booking: "bkg-av7702", optionId: "x", cardLast4: "44" }),
      call({ booking: "nope", optionId: "x", cardLast4: VALID_CARD }),
    ]);
    for (const res of responses) {
      expect(await res.text()).not.toContain(VALID_CARD);
    }
  });

  it("401s an unreadable confirmation without saying what was wrong with it", async () => {
    for (const typed of ["", "44", "-4417", "44 17", "44.17"]) {
      const res = await call({
        booking: "bkg-av7702",
        optionId: paidOption("bkg-av7702").id,
        cardLast4: typed,
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("INVALID_CARD_CONFIRMATION");
    }
    expect(booking("bkg-av7702").status).toBe("ticketed");
  });

  it("checks the card BEFORE consulting the ledger", async () => {
    // The 404 and 422 below are ANSWERS — they tell an unauthenticated caller
    // which bookings exist and which options are available on them.
    const res = await call({
      booking: "bkg-av2214",
      optionId: "o-nope",
      cardLast4: "",
    });
    expect(res.status).toBe(401);
  });

  it("REFUSES when nothing is due, rather than staging a $0 authorization", async () => {
    // Asking for a card to move $0 is a formality dressed up as an
    // authorization — the same bug logistics' $0 `absorb` option produced.
    const free = optionsForBooking(store.options(), "bkg-av1466").find(
      (o) => o.fareDifferenceUsd === 0,
    );
    if (!free) throw new Error("no free option");
    const res = await call({
      booking: "bkg-av1466",
      optionId: free.id,
      cardLast4: VALID_CARD,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("NOTHING_DUE");
    expect(booking("bkg-av1466").status).toBe("ticketed");
  });
});

describe("⚠️ THE CARD IS NOT AN ENTITLEMENT OVERRIDE", () => {
  // This block is the only symptom the failure has. If a valid card could
  // release a non-changeable fare, the agent would have a second door around
  // beat 6, the teach arc would never fire, and NOTHING else would go red: the
  // card is gorgeous, the write lands, the room applauds, and the demo proves
  // the opposite of its claim.

  it("REFUSES a valid card on a non-changeable fare, with the FARE error", async () => {
    const option = paidOption("bkg-av2214");
    const res = await call({
      booking: "bkg-av2214",
      optionId: option.id,
      cardLast4: VALID_CARD,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("FARE_NOT_CHANGEABLE");
    expect(booking("bkg-av2214").status).toBe("ticketed");
  });

  it("refuses EVERY option on such a booking, discovered from the live ledger", async () => {
    // Not hardcoded: a seed change must not be able to turn this assertion
    // vacuous. And walking all of them is the point — Aeronova's gate is a
    // property of the FARE, not of an amount, so no choice of option can slip
    // past it (which is a stronger position than logistics' cost gate).
    for (const bookingId of ["bkg-av2214", "bkg-av0918", "bkg-av1188"]) {
      const options = optionsForBooking(store.options(), bookingId);
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        const res = await call({
          booking: bookingId,
          optionId: option.id,
          cardLast4: VALID_CARD,
        });
        expect(res.status).toBe(422);
        expect((await res.json()).error).toBe("FARE_NOT_CHANGEABLE");
      }
    }
  });

  it("says what the unlock path IS: a grounded exception lifts the same block", async () => {
    // The companion assertion. Without it this block only says what the card is
    // NOT, and a gate that refused everything would pass the test above.
    const filed = store.fileException(
      booking("bkg-av2214"),
      "SCHEDULE_CHANGE_TRIGGERED",
      "notice AV-88214",
      "",
    );
    if (!filed.ok) throw new Error("could not file");
    store.approveException(filed.exception.id);

    const option = paidOption("bkg-av2214");
    const res = await call({
      booking: "bkg-av2214",
      optionId: option.id,
      cardLast4: VALID_CARD,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permission).toBe("exception");
    // The exception waives the fare's change fee; the fare difference is still
    // the passenger's to pay, which is why the card was needed at all.
    expect(body.amountPaidUsd).toBe(option.fareDifferenceUsd);
  });

  it("leaks nothing about the catalogue in its refusal", async () => {
    const body = await (
      await call({
        booking: "bkg-av0918",
        optionId: paidOption("bkg-av0918").id,
        cardLast4: VALID_CARD,
      })
    ).text();
    for (const leak of ["exception", "waiver", "categor", "MEDICAL"]) {
      expect(body.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});

describe("request hygiene", () => {
  it("400s a body that is not a JSON object", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: "nope" }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a booking already reissued", async () => {
    const option = paidOption("bkg-av7702");
    await call({
      booking: "bkg-av7702",
      optionId: option.id,
      cardLast4: VALID_CARD,
    });
    const res = await call({
      booking: "bkg-av7702",
      optionId: option.id,
      cardLast4: VALID_CARD,
    });
    expect(res.status).toBe(409);
  });

  it("422s an option belonging to another booking", async () => {
    const res = await call({
      booking: "bkg-av7702",
      optionId: "o-1478-e",
      cardLast4: VALID_CARD,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("UNAVAILABLE_OPTION");
  });

  it("409s an ambiguous PNR rather than reissuing the wrong leg", async () => {
    const res = await call({
      booking: "AV7QK2",
      optionId: "o-1423-c",
      cardLast4: VALID_CARD,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("AMBIGUOUS_REFERENCE");
  });
});
