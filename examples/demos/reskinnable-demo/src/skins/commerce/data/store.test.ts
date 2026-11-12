import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorResponse } from "./http";
import * as store from "./store";
import { NOTIFICATION_TEMPLATES } from "./types";
import type { Promotion } from "./types";
import { JUSTIFICATION_MAX_LENGTH } from "./waiver-codes";

beforeEach(() => store.reset());

/**
 * The server-side ledger, with the emphasis on the two things the demo cannot
 * survive being wrong: the beat-6 gate, and the beat-3a refund's refusal to let
 * a figure escape into anything the agent can read.
 */
describe("seed", () => {
  it("seeds exactly two below-floor products, so beats 1 and 4 have something to flag", () => {
    const below = store.products().filter(store.isBelowFloor);
    expect(below.map((p) => p.id).sort()).toEqual([
      "prd-harbor-parka",
      "prd-lark-runner",
    ]);
  });

  it("seeds TWO gated markdowns and one clean one", () => {
    const pending = store
      .promotions()
      .filter((p) => store.promotionApprovalBlocker(p) === null);
    const gated = store
      .promotions()
      .filter(
        (p) => store.promotionApprovalBlocker(p) === "BELOW_MARGIN_FLOOR",
      );

    // Two gated: one is taught on stage, the other is the unaided replay. The
    // demonstration RESOLVES its own case, so a single gated record would leave
    // beat 6 with nothing to prove it learned anything.
    expect(gated.map((p) => p.id).sort()).toEqual([
      "promo-cedar",
      "promo-slate",
    ]);
    // And one that approves in a single call, so the gate cannot be mistaken
    // for "approval always fails".
    expect(pending.map((p) => p.id)).toContain("promo-terra");
  });

  it("keeps every order's total and product references honest", () => {
    for (const order of store.orders()) {
      const lineSum = order.lines.reduce(
        (sum, line) => sum + line.quantity * line.unitPrice,
        0,
      );
      expect(order.total, `total on ${order.number}`).toBe(lineSum);
      for (const line of order.lines) {
        expect(store.product(line.productId), line.productId).toBeDefined();
      }
    }
  });

  it("keeps every return's item value and prose agreeing with its order line", () => {
    // THREE numbers describe one return — the units the order actually carried,
    // the units `itemValue` is worth, and any count the `detail` prose states —
    // and the assistant mixes all three in one breath: it quotes the prose
    // VERBATIM while its arithmetic comes from the fields. `ret-2204` shipped as
    // "Bought three" against a four-unit line and a two-unit `itemValue`: three
    // different quantities for one return, so the assistant contradicted the
    // record it was reading from, live, while a refund was being decided.
    //
    // Pinned as an INVARIANT over every return rather than as values, so the
    // seed's figures and prose stay freely editable afterwards.
    const NUMBER_WORDS: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
    };
    const statedCounts = (detail: string): number[] =>
      (
        detail
          .toLowerCase()
          .match(
            /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
          ) ?? []
      ).map((token) => NUMBER_WORDS[token] ?? Number(token));

    for (const request of store.returns()) {
      const parent = store.order(request.orderId);
      expect(parent, `order behind ${request.id}`).toBeDefined();
      const line = parent?.lines.find((l) => l.productId === request.productId);
      expect(
        line,
        `${request.id}'s line on ${request.orderNumber}`,
      ).toBeDefined();
      if (!line) continue;

      // `itemValue` is "what the item was originally charged at", so it can only
      // be a whole number of units at the price the order actually charged, and
      // never more units than the order carried.
      expect(
        request.itemValue % line.unitPrice,
        `${request.id} itemValue ${request.itemValue} against unit price ${line.unitPrice}`,
      ).toBe(0);
      const returnedUnits = request.itemValue / line.unitPrice;
      expect(
        returnedUnits,
        `${request.id} returned units`,
      ).toBeGreaterThanOrEqual(1);
      expect(returnedUnits, `${request.id} returned units`).toBeLessThanOrEqual(
        line.quantity,
      );

      // Any count the prose states must be one of the two counts that are real:
      // how many were bought, or how many are going back. A third number is the
      // bug — and a prose number that means something else (a duration, a size)
      // must not be spelled as a bare count.
      for (const stated of statedCounts(request.detail)) {
        expect(
          [returnedUnits, line.quantity],
          `${request.id} prose states ${stated}: "${request.detail}"`,
        ).toContain(stated);
      }
    }
  });

  it("numbers orders monotonically with placement time, oldest lowest", () => {
    // Order numbers are issued sequentially in every real commerce system, and
    // beat 3c puts the queue on screen sorted OLDEST FIRST. A reversed sequence
    // makes the number column count DOWN in front of the room, which reads as
    // broken data — the audience stops trusting the ledger before it evaluates
    // the agent. Pinned as an INVARIANT, not as values: the seed may re-space
    // its numbers freely so long as older still means lower.
    const byAge = [...store.orders()].sort((a, b) =>
      a.placedAt.localeCompare(b.placedAt),
    );
    for (let i = 1; i < byAge.length; i++) {
      const older = byAge[i - 1];
      const newer = byAge[i];
      expect(
        Number(newer.number),
        `${newer.number} (placed ${newer.placedAt}) must outrank ${older.number} (placed ${older.placedAt})`,
      ).toBeGreaterThan(Number(older.number));
    }
  });

  it("resolves an order by its human-facing number as well as its id", () => {
    // The agent reads "order 4471" off the page; refusing that spelling would
    // be a routing failure dressed up as a 404.
    expect(store.order("4471")?.id).toBe("ord-4471");
    expect(store.order("ord-4471")?.number).toBe("4471");
    expect(store.order("nope")).toBeUndefined();
  });
});

/**
 * BEAT 3c — the `top=10` lever must actually CUT something.
 *
 * The beat's whole claim is that the assistant reached into the app's real
 * controls. A limit that truncates nothing is the worst possible outcome for
 * that claim: the queue renders exactly as it would have anyway, the control
 * tints, and the room is asked to believe a maneuver happened. It shipped that
 * way — nine exception orders against a limit of ten.
 *
 * The queue clause lives in `pages/orders.tsx`'s `visible` useMemo, which is a
 * client component reading its levers off `useSearchParams`; it is mirrored here
 * rather than imported. Both clauses below are one line, and the counts they
 * measure — not the mirroring — are what these tests defend.
 */
/** `sort=aging_desc` — oldest first, exactly as `SORTS.aging_desc` compares. */
const oldestFirst = <T extends { placedAt: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.placedAt.localeCompare(b.placedAt));

describe("BEAT 3c — the top-N lever", () => {
  const TOP = 10;
  /** `exception=any` — every order still carrying one. Status left at "all". */
  const onException = () =>
    store.orders().filter((o) => o.exception !== "none");

  it("leaves more than ten rows in the view the beat actually builds", () => {
    // status=all & exception=any — the lever set the tool description and the
    // prompt both steer towards, because a pinned status empties itself the
    // moment beat 5 puts an order on hold.
    expect(onException().length).toBeGreaterThan(TOP);
  });

  it("still exceeds ten when the status lever is pinned to open", () => {
    // A user can still ask for open orders by name, and the limit has to bite in
    // that view too.
    expect(
      onException().filter((o) => o.status === "open").length,
    ).toBeGreaterThan(TOP);
  });

  it("keeps order 4471 inside the ten oldest, so beat 5's writes stay visible", () => {
    // Truncation excludes rows just as a status filter does. Beat 5 posts a hold
    // and a forced-🚨 note onto 4471 while the room is looking at the view beat
    // 3c built — so every exception order seeded to make the limit bite must be
    // NEWER than 4471, leaving it inside the visible ten.
    const visible = oldestFirst(onException()).slice(0, TOP);
    expect(visible.map((o) => o.id)).toContain("ord-4471");
    // …and the limit really is cutting rows, not just fitting.
    expect(onException().length - visible.length).toBeGreaterThan(0);
  });
});

describe("margin", () => {
  it("computes gross margin at a price and guards a zero price", () => {
    expect(store.marginAt(100, 40)).toBeCloseTo(0.6, 5);
    expect(store.marginAt(0, 40)).toBe(0);
  });

  it("keeps the clamped ratio separate from the raw below-floor test", () => {
    // The ratio positions a dot on the ladder rail and is clamped to [0,1];
    // `belowFloor` is the RAW comparison. Clamping must never hide a violation.
    const under = store.marginPosition("Footwear", 0.2); // floor 0.40
    expect(under.ratio).toBe(0);
    expect(under.belowFloor).toBe(true);

    const over = store.marginPosition("Footwear", 0.95); // above the ceiling
    expect(over.ratio).toBe(1);
    expect(over.belowFloor).toBe(false);
  });

  it("prices a discount to the cent, not to the dollar", () => {
    expect(store.discountedPrice(128, 40)).toBe(76.8);
    expect(store.discountedPrice(48, 20)).toBe(38.4);
  });
});

describe("BEAT 6 — the gate", () => {
  const CEDAR = "promo-cedar";

  it("refuses a below-floor markdown with a symptom-only code", () => {
    expect(() => store.approvePromotion(CEDAR)).toThrow("BELOW_MARGIN_FLOOR");
  });

  it("approves a markdown that stays above its category floor", () => {
    const { promotion } = store.approvePromotion("promo-terra");
    expect(promotion.status).toBe("approved");
  });

  it("a DECOY waiver files, finalizes, links — and still does not lift the gate", () => {
    const waiver = store.openMarginWaiver(CEDAR, "MERCH-DISC", "judgement");
    expect(waiver.status).toBe("draft");

    const finalized = store.finalizeMarginWaiver(waiver.id);
    expect(finalized.status).toBe("approved");
    // It really is on file — the history is honest about it...
    expect(store.waiversFor(CEDAR)).toHaveLength(1);
    expect(store.promotions().find((p) => p.id === CEDAR)?.marginWaiverId).toBe(
      waiver.id,
    );
    // ...and it still does not clear the floor.
    expect(() => store.approvePromotion(CEDAR)).toThrow("BELOW_MARGIN_FLOOR");
  });

  it("a JUSTIFYING waiver lifts the gate only once it is finalized", () => {
    const waiver = store.openMarginWaiver(CEDAR, "VENDOR-FUND", "signed co-op");
    // A draft is not enough — filing is not approving.
    expect(() => store.approvePromotion(CEDAR)).toThrow("BELOW_MARGIN_FLOOR");

    store.finalizeMarginWaiver(waiver.id);
    const { promotion } = store.approvePromotion(CEDAR);
    expect(promotion.status).toBe("approved");
  });

  it("never lets a DECOY finalized afterwards steal the credit for the unlock", () => {
    // `marginWaiverId` names the waiver the markdown's approvability rests on.
    // If a decoy finalized later displaced it, the record would credit the code
    // that justifies nothing — contradicting the beat on screen.
    const justifying = store.openMarginWaiver(CEDAR, "EOL-CLEAR", "range exit");
    store.finalizeMarginWaiver(justifying.id);
    expect(store.promotions().find((p) => p.id === CEDAR)?.marginWaiverId).toBe(
      justifying.id,
    );

    const decoy = store.openMarginWaiver(CEDAR, "VOL-LIFT", "units will come");
    store.finalizeMarginWaiver(decoy.id);

    // The credit stays with the waiver that actually cleared the floor...
    expect(store.promotions().find((p) => p.id === CEDAR)?.marginWaiverId).toBe(
      justifying.id,
    );
    // ...the history is still honest that both were filed and finalized...
    expect(
      store
        .waiversFor(CEDAR)
        .map((w) => w.code)
        .sort(),
    ).toEqual(["EOL-CLEAR", "VOL-LIFT"]);
    expect(store.waiversFor(CEDAR).every((w) => w.status === "approved")).toBe(
      true,
    );
    // ...and the gate stays lifted.
    expect(store.hasApprovedJustifyingWaiver(CEDAR)).toBe(true);
    expect(store.approvePromotion(CEDAR).promotion.status).toBe("approved");
  });

  it("upgrades the credit when the justifying waiver arrives second", () => {
    const decoy = store.openMarginWaiver(CEDAR, "MERCH-DISC", "judgement");
    store.finalizeMarginWaiver(decoy.id);
    expect(store.promotions().find((p) => p.id === CEDAR)?.marginWaiverId).toBe(
      decoy.id,
    );

    // ≥ JUSTIFICATION_MIN_LENGTH: filings now require real written paperwork,
    // so "on file" (7 chars) is refused as INVALID_JUSTIFICATION.
    const justifying = store.openMarginWaiver(
      CEDAR,
      "COMP-MATCH",
      "competitor match confirmed, quote on file",
    );
    store.finalizeMarginWaiver(justifying.id);
    // A decoy holding the slot is not a justifying link, so it yields to one.
    expect(store.promotions().find((p) => p.id === CEDAR)?.marginWaiverId).toBe(
      justifying.id,
    );
  });

  it("rejects an unknown code without revealing the catalogue", () => {
    expect(() =>
      store.openMarginWaiver(CEDAR, "MADE-UP", "signed co-op"),
    ).toThrow("INVALID_WAIVER_CODE");
    expect(() =>
      store.openMarginWaiver("nope", "VENDOR-FUND", "signed co-op"),
    ).toThrow("NOT_FOUND");
  });

  it("refuses a waiver filed with no written justification", () => {
    // The gate is only as real as the paperwork behind it. A JUSTIFYING code
    // with an empty justification used to file, finalize and lift the floor
    // while recording nothing about why — which made the "file the paperwork"
    // half of the beat a formality the agent could satisfy with `""`.
    const nonAnswers = ["", "   ", "\n\t ", "x", "n/a", "ok", "none"];
    for (const empty of nonAnswers) {
      expect(
        () => store.openMarginWaiver(CEDAR, "VENDOR-FUND", empty),
        JSON.stringify(empty),
      ).toThrow("INVALID_JUSTIFICATION");
    }
    // Nothing was recorded, and the floor is still armed.
    expect(store.waiversFor(CEDAR)).toHaveLength(0);
    expect(() => store.approvePromotion(CEDAR)).toThrow("BELOW_MARGIN_FLOOR");
  });

  it("refuses an unbounded justification, and a non-string one", () => {
    // The text is written into the durable store from a model-authored tool
    // argument, so it needs a ceiling as well as a floor.
    expect(() =>
      store.openMarginWaiver(
        CEDAR,
        "VENDOR-FUND",
        "co-op ".repeat(JUSTIFICATION_MAX_LENGTH),
      ),
    ).toThrow("INVALID_JUSTIFICATION");
    // Exactly at the ceiling is fine; one over is not.
    const atMax = "c".repeat(JUSTIFICATION_MAX_LENGTH);
    expect(
      store.openMarginWaiver(CEDAR, "VENDOR-FUND", atMax).justification,
    ).toHaveLength(JUSTIFICATION_MAX_LENGTH);
    expect(() =>
      store.openMarginWaiver(CEDAR, "VENDOR-FUND", `${atMax}c`),
    ).toThrow("INVALID_JUSTIFICATION");
    // And `String({})` is 15 characters of nothing — the coercion the routes'
    // house pattern would otherwise have laundered past the floor.
    for (const wrong of [{}, [], null, undefined, 12345678, true]) {
      expect(
        () => store.openMarginWaiver(CEDAR, "VENDOR-FUND", wrong),
        JSON.stringify(wrong ?? null),
      ).toThrow("INVALID_JUSTIFICATION");
    }
  });

  it("still lifts the gate for a real justification, and trims it", () => {
    const waiver = store.openMarginWaiver(
      CEDAR,
      "VENDOR-FUND",
      "  signed co-op on file with Buying  ",
    );
    expect(waiver.justification).toBe("signed co-op on file with Buying");
    store.finalizeMarginWaiver(waiver.id);
    expect(store.approvePromotion(CEDAR).promotion.status).toBe("approved");
  });

  it("a waiver on ONE markdown never unlocks another", () => {
    const waiver = store.openMarginWaiver(CEDAR, "VENDOR-FUND", "signed co-op");
    store.finalizeMarginWaiver(waiver.id);
    store.approvePromotion(CEDAR);
    // promo-slate is the unaided replay; teaching on Cedar must not clear it.
    expect(() => store.approvePromotion("promo-slate")).toThrow(
      "BELOW_MARGIN_FLOOR",
    );
  });

  /**
   * Paperwork only means something while the decision is still open.
   *
   * A waiver filed against a markdown that has ALREADY been approved or declined
   * is retro-justification: it files, it finalizes, and `creditWaiver` writes its
   * id onto the promotion — so the Promotions page credits a code as the reason a
   * markdown became approvable when in fact nobody consulted it. These three pin
   * both halves of the precondition (filing AND finalizing) and both decided
   * states.
   */
  it("refuses a waiver filed against a markdown that was already decided", () => {
    // promo-fern is seeded APPROVED: the retro-justification case.
    expect(() =>
      store.openMarginWaiver("promo-fern", "VENDOR-FUND", "signed co-op"),
    ).toThrow("ALREADY_DECIDED");

    // And DECLINED, which is terminal — nothing returns a promotion to pending,
    // so a waiver against it could never lift anything.
    store.declinePromotion("promo-slate");
    expect(() =>
      store.openMarginWaiver("promo-slate", "VENDOR-FUND", "signed co-op"),
    ).toThrow("ALREADY_DECIDED");

    // Nothing was recorded against either, so `waiversFor` — which the page
    // renders — stays honest.
    expect(store.waiversFor("promo-fern")).toHaveLength(0);
    expect(store.waiversFor("promo-slate")).toHaveLength(0);
  });

  it("refuses to finalize a draft once the markdown has been decided", () => {
    // Why guarding `openMarginWaiver` alone is not enough: this draft was opened
    // legitimately, WHILE promo-terra was still pending. promo-terra is the
    // markdown that approves in one call, so the decision lands without the
    // waiver ever being consulted — and finalizing afterwards would link it.
    const waiver = store.openMarginWaiver(
      "promo-terra",
      "VENDOR-FUND",
      "signed co-op on file",
    );
    store.approvePromotion("promo-terra");

    expect(() => store.finalizeMarginWaiver(waiver.id)).toThrow(
      "ALREADY_DECIDED",
    );
    // The refusal is whole: no half-finalized waiver, and no link written.
    const stored = store.waivers().find((w) => w.id === waiver.id);
    expect(stored?.status).toBe("draft");
    expect(stored?.finalizedAt).toBeNull();
    expect(
      store.promotions().find((p) => p.id === "promo-terra")?.marginWaiverId,
    ).toBeNull();
  });

  it("still runs the beat-6 sequence on the taught case AND the replay", () => {
    // The ordering the beat actually performs — file under a justifying code,
    // finalize, approve — on BOTH seeded below-floor markdowns: the one taught on
    // stage and the one the agent replays unaided. If the guards above ever
    // reached into this sequence, beat 6 would be gone.
    for (const id of ["promo-cedar", "promo-slate"]) {
      const waiver = store.openMarginWaiver(
        id,
        "VENDOR-FUND",
        "signed co-op on file with Buying",
      );
      expect(store.finalizeMarginWaiver(waiver.id).status).toBe("approved");
      expect(store.approvePromotion(id).promotion.status).toBe("approved");
      expect(store.promotions().find((p) => p.id === id)?.marginWaiverId).toBe(
        waiver.id,
      );
    }
  });

  it("refuses to finalize the same waiver twice, or to re-approve", () => {
    const waiver = store.openMarginWaiver(CEDAR, "VENDOR-FUND", "co-op filed");
    store.finalizeMarginWaiver(waiver.id);
    expect(() => store.finalizeMarginWaiver(waiver.id)).toThrow(
      "ALREADY_FINALIZED",
    );
    store.approvePromotion(CEDAR);
    expect(() => store.approvePromotion(CEDAR)).toThrow("ALREADY_DECIDED");
  });
});

/**
 * A DANGLING reference is not a not-found.
 *
 * `NOT_FOUND` means "the record you named is not here" — a caller error, and one
 * the agent can act on by naming a different record. A promotion whose
 * `productId` resolves to nothing means our own ledger is inconsistent, which no
 * caller can act on. Both used to raise `NOT_FOUND`, so `approvePromotion`
 * answered a broken invariant with the very same `404 "That record does not
 * exist."` it answers a typo with, and logged nothing at all — the two states
 * were indistinguishable from outside. These assertions pin them apart at both
 * layers: the code the store raises, and what `errorResponse` does with it.
 */
describe("ledger integrity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Corrupt one seeded promotion's product reference. `reset()` undoes it. */
  const dangleProduct = (promotionId: string): Promotion => {
    const promotion = store.promotions().find((p) => p.id === promotionId);
    if (!promotion) throw new Error(`no seeded promotion ${promotionId}`);
    promotion.productId = "prd-that-was-deleted";
    return promotion;
  };

  it("has no dangling reference in the seed today", () => {
    // The defect is only reachable from a CORRUPTED store, and that is worth
    // keeping true: this is what fails if a future seed edit ships a real one.
    for (const promotion of store.promotions()) {
      expect(store.product(promotion.productId), promotion.id).toBeDefined();
    }
    for (const request of store.returns()) {
      expect(store.product(request.productId), request.id).toBeDefined();
    }
  });

  it("still reports a promotion id nobody has as the routine not-found", () => {
    expect(() => store.approvePromotion("promo-nope")).toThrow("NOT_FOUND");
    expect(() => store.declinePromotion("promo-nope")).toThrow("NOT_FOUND");
    expect(() =>
      store.openMarginWaiver("promo-nope", "VENDOR-FUND", "x"),
    ).toThrow("NOT_FOUND");
  });

  it("reports a promotion pointing at a missing product as an integrity fault", () => {
    // promo-terra is the markdown that otherwise approves in one call, so the
    // only thing standing between it and success here is the dangling ref.
    const promotion = dangleProduct("promo-terra");
    expect(store.promotionApprovalBlocker(promotion)).toBe(
      "DANGLING_PRODUCT_REF",
    );
    expect(() => store.approvePromotion("promo-terra")).toThrow(
      "DANGLING_PRODUCT_REF",
    );
    // …and the approval did not half-land.
    expect(store.promotions().find((p) => p.id === "promo-terra")?.status).toBe(
      "pending",
    );
  });

  it("reports a waiver pointing at a missing promotion, and finalizes nothing", () => {
    const waiver = store.openMarginWaiver(
      "promo-cedar",
      "VENDOR-FUND",
      "signed co-op",
    );
    waiver.promotionId = "promo-that-was-deleted";
    expect(() => store.finalizeMarginWaiver(waiver.id)).toThrow(
      "DANGLING_PROMOTION_REF",
    );
    // The refusal is whole. This used to finalize the waiver, answer 200, and
    // drop the promotion link in silence.
    const stored = store.waivers().find((w) => w.id === waiver.id);
    expect(stored?.status).toBe("draft");
    expect(stored?.finalizedAt).toBeNull();
  });

  // End to end through the REAL mapper the approve route uses, because the whole
  // point of the finding is what the CALLER and the LOG can tell apart.
  it("hands the caller and the server log two different answers", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const respond = (run: () => unknown): Response => {
      try {
        run();
      } catch (error) {
        return errorResponse(error, "POST promotions/[id]/approve");
      }
      throw new Error("expected the store to refuse");
    };

    // A caller error: actionable, and not worth a line in the log.
    const missing = respond(() => store.approvePromotion("promo-nope"));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: "NOT_FOUND",
    });
    expect(log).not.toHaveBeenCalled();

    // Our bug: never dressed up as a routine 404, and loud on the server.
    dangleProduct("promo-terra");
    const broken = respond(() => store.approvePromotion("promo-terra"));
    expect(broken.status).toBe(500);
    await expect(broken.json()).resolves.toMatchObject({
      error: "INTERNAL_ERROR",
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toMatchObject({
      message: "DANGLING_PRODUCT_REF",
    });
  });
});

describe("BEAT 3a — the refund", () => {
  it("records the amount on the return and marks it refunded", () => {
    const updated = store.issueRefund("ret-2210", 85);
    expect(updated.status).toBe("refunded");
    expect(updated.refundAmount).toBe(85);
  });

  it("refuses an amount above what was charged, and a second refund", () => {
    // A refund over the item value is a data-entry slip, not a policy call —
    // letting it through would quietly distort the margin figures the whole app
    // is about.
    expect(() => store.issueRefund("ret-2210", 999_999)).toThrow(
      "REFUND_EXCEEDS_VALUE",
    );
    expect(() => store.issueRefund("ret-2210", 0)).toThrow("INVALID_AMOUNT");
    store.issueRefund("ret-2210", 85);
    expect(() => store.issueRefund("ret-2210", 10)).toThrow("ALREADY_REFUNDED");
  });

  it("refuses to refund a return nobody approved, or one that was declined", () => {
    // A refund settles the return terminally. Three of the five seeded returns
    // are still `requested`, and the agent's return finder matches on a fuzzy
    // substring — so without this guard a loose phrase settles a return that
    // was never decided.
    expect(() => store.issueRefund("ret-2204", 50)).toThrow(
      "RETURN_NOT_APPROVED",
    );
    const untouched = store.returns().find((r) => r.id === "ret-2204");
    expect(untouched?.status).toBe("requested");
    expect(untouched?.refundAmount).toBeNull();

    // And a human's explicit refusal is not something a refund may overwrite.
    store.decideReturn("ret-2201", "declined");
    expect(() => store.issueRefund("ret-2201", 50)).toThrow(
      "RETURN_NOT_APPROVED",
    );
    const declined = store.returns().find((r) => r.id === "ret-2201");
    expect(declined?.status).toBe("declined");
    expect(declined?.refundAmount).toBeNull();
  });

  it("still refunds the approved return the demo actually uses", () => {
    // ret-2210 is seeded `approved`; beat 3a must keep working unaided.
    expect(store.issueRefund("ret-2210", 85).status).toBe("refunded");
    // As must approve-then-refund, the Returns desk's own two-step.
    expect(store.decideReturn("ret-2204", "approved").status).toBe("approved");
    expect(store.issueRefund("ret-2204", 50).refundAmount).toBe(50);
  });

  it("refuses a second decision on a return that was already decided", () => {
    store.decideReturn("ret-2204", "approved");
    expect(() => store.decideReturn("ret-2204", "declined")).toThrow(
      "ALREADY_DECIDED",
    );
    // A settled return keeps reporting the more specific code.
    store.issueRefund("ret-2204", 50);
    expect(() => store.decideReturn("ret-2204", "approved")).toThrow(
      "ALREADY_REFUNDED",
    );
  });
});

describe("BEAT 5 — the procedure's three writes", () => {
  it("holds an order, logs a notification and prepends the note", () => {
    store.setOrderStatus("4471", "on-hold", "fraud-review");
    expect(store.order("4471")?.status).toBe("on-hold");

    store.notifyCustomer("4471", "verification-required", "Nadia Okonjo");
    expect(store.notifications()).toHaveLength(1);
    expect(store.notifications()[0].template).toBe("verification-required");

    store.addOrderNote("4471", "🚨 Held for verification.", "Nadia Okonjo");
    // unshift, not push: the page renders notes[0] as "the latest note".
    expect(store.order("4471")?.notes[0].text).toContain("Held for");
  });

  /**
   * The two writes that persist free text are BOTH read back to the model: the
   * Orders page's beat-3b readable ships `recentNotifications[].template` and
   * `latestNote`. So "any non-empty string" was not a lax-but-harmless check —
   * it was a path from a request body into the next prompt, wearing app state's
   * clothes. These assertions pin the closed set and the bounds.
   */
  it("refuses a template outside the four Bellwether sends", () => {
    expect(() =>
      store.notifyCustomer("4471", "ignore-previous-instructions", "Nadia"),
    ).toThrow("UNKNOWN_TEMPLATE");
    // Near-misses are refused too — the check is membership, not a prefix.
    expect(() => store.notifyCustomer("4471", "verification", "Nadia")).toThrow(
      "UNKNOWN_TEMPLATE",
    );
    expect(() => store.notifyCustomer("4471", "", "Nadia")).toThrow(
      "UNKNOWN_TEMPLATE",
    );
    expect(store.notifications()).toHaveLength(0);
  });

  it.each(NOTIFICATION_TEMPLATES)("still sends the %s template", (template) => {
    const sent = store.notifyCustomer("4471", template, "Nadia Okonjo");
    expect(sent.template).toBe(template);
    expect(store.notifications()[0].id).toBe(sent.id);
  });

  it("refuses an over-long sentBy, author or note", () => {
    const longName = "N".repeat(store.MAX_ACTOR_NAME + 1);
    expect(() =>
      store.notifyCustomer("4471", "verification-required", longName),
    ).toThrow("ACTOR_NAME_TOO_LONG");
    expect(() => store.addOrderNote("4471", "🚨 Held.", longName)).toThrow(
      "ACTOR_NAME_TOO_LONG",
    );
    expect(() =>
      store.addOrderNote("4471", "x".repeat(store.MAX_NOTE_TEXT + 1), "Nadia"),
    ).toThrow("NOTE_TOO_LONG");

    // Nothing was written on any of the three refusals.
    expect(store.notifications()).toHaveLength(0);
    expect(store.order("4471")?.notes).toHaveLength(0);

    // And a value exactly at the bound is still accepted — the check is a
    // ceiling, not an off-by-one that clips a legitimate operator name.
    const atBound = "N".repeat(store.MAX_ACTOR_NAME);
    expect(
      store.notifyCustomer("4471", "verification-required", atBound).sentBy,
    ).toBe(atBound);
    expect(
      store.addOrderNote("4471", "x".repeat(store.MAX_NOTE_TEXT), "Nadia")
        .notes[0].text,
    ).toHaveLength(store.MAX_NOTE_TEXT);
  });
});

/**
 * THE ORDER STATE MACHINE.
 *
 * Without it the PATCH route accepted any status/exception combination it could
 * spell, and two of those combinations are demo-destroying rather than merely
 * untidy:
 *
 *  - `cancelled → open` resurrected a cancelled order;
 *  - `fulfilled` alongside a live exception put a SHIPPED order in the
 *    exception queue and added its total to the `valueAtRisk` KPI the room is
 *    being asked to read as money still at risk.
 *
 * Both are reachable from the agent: `holdOrder` PATCHes a status, and the
 * order finder matches on a loose phrase, so a wrong row is one fuzzy match
 * away.
 */
/**
 * These reference orders by ID, never by NUMBER.
 *
 * Order numbers are re-spaceable data: the monotonicity test above pins "older
 * means lower" as an INVARIANT and explicitly licenses the seed to renumber
 * freely. This block was originally written against hardcoded numbers and every
 * case broke the moment the seed was renumbered to satisfy that invariant —
 * `store.order()` accepts either spelling, so the failures surfaced as
 * `NOT_FOUND` rather than as anything about the state machine. Ids are the stable
 * handle; the CONSTANTS below say which seeded shape each case needs, so a future
 * reseed can repoint them in one place.
 */
const OPEN_CLEAN_A = "ord-4469"; // open, exception: none
const OPEN_CLEAN_B = "ord-4477"; // open, exception: none
const OPEN_CLEAN_C = "ord-4483"; // open, exception: none
const HELD = "ord-4453"; // on-hold, fraud-review
const OPEN_WITH_EXCEPTION = "ord-4471"; // open, fraud-review — beat 5's subject

describe("the order state machine", () => {
  it("refuses to resurrect a cancelled order", () => {
    expect(store.setOrderStatus(OPEN_CLEAN_A, "cancelled").status).toBe(
      "cancelled",
    );
    expect(() => store.setOrderStatus(OPEN_CLEAN_A, "open")).toThrow(
      "ORDER_ALREADY_SETTLED",
    );
    expect(store.order(OPEN_CLEAN_A)?.status).toBe("cancelled");
  });

  it("refuses to change a fulfilled order at all", () => {
    store.setOrderStatus(OPEN_CLEAN_B, "fulfilled");
    expect(() =>
      store.setOrderStatus(OPEN_CLEAN_B, "on-hold", "oversell"),
    ).toThrow("ORDER_ALREADY_SETTLED");
    expect(store.order(OPEN_CLEAN_B)?.status).toBe("fulfilled");
    expect(store.order(OPEN_CLEAN_B)?.exception).toBe("none");
  });

  it("refuses a fulfilled order that carries an exception", () => {
    // The KPI-inflating pair, written explicitly...
    expect(() =>
      store.setOrderStatus(OPEN_CLEAN_B, "fulfilled", "fraud-review"),
    ).toThrow("EXCEPTION_ON_SETTLED_ORDER");
    expect(store.order(OPEN_CLEAN_B)?.status).toBe("open");

    // ...and reached the other way, by settling an order that already has one
    // and saying nothing about it.
    expect(() =>
      store.setOrderStatus(OPEN_WITH_EXCEPTION, "fulfilled"),
    ).toThrow("EXCEPTION_ON_SETTLED_ORDER");
    expect(() =>
      store.setOrderStatus(OPEN_WITH_EXCEPTION, "cancelled"),
    ).toThrow("EXCEPTION_ON_SETTLED_ORDER");
    expect(store.order(OPEN_WITH_EXCEPTION)?.status).toBe("open");

    // Clearing it in the same write is the sanctioned path.
    expect(
      store.setOrderStatus(OPEN_WITH_EXCEPTION, "cancelled", "none").status,
    ).toBe("cancelled");
  });

  it("makes a held order be released before it can ship", () => {
    // A hold STOPS fulfillment; shipping straight out of one contradicts what
    // the hold did.
    expect(() => store.setOrderStatus(HELD, "fulfilled", "none")).toThrow(
      "ILLEGAL_ORDER_TRANSITION",
    );
    store.setOrderStatus(HELD, "open", "none");
    expect(store.setOrderStatus(HELD, "fulfilled").status).toBe("fulfilled");
  });

  it("still allows every transition the demo beats rely on", () => {
    // BEAT 5, step 1 — open → on-hold with the exception that caused it.
    const held = store.setOrderStatus(
      OPEN_WITH_EXCEPTION,
      "on-hold",
      "fraud-review",
    );
    expect(held.status).toBe("on-hold");
    expect(held.exception).toBe("fraud-review");

    // Re-holding under a restated exception is a legitimate correction.
    const reheld = store.setOrderStatus(
      OPEN_WITH_EXCEPTION,
      "on-hold",
      "payment-declined",
    );
    expect(reheld.exception).toBe("payment-declined");

    // The Orders page's "clear the exception" control, on a HELD row.
    const released = store.setOrderStatus(OPEN_WITH_EXCEPTION, "open", "none");
    expect(released.status).toBe("open");
    expect(released.exception).toBe("none");

    // ...and on a row that is already open, which is the common case. An
    // idempotent open → open must not be mistaken for an illegal transition.
    expect(store.setOrderStatus(OPEN_CLEAN_C, "open", "none").exception).toBe(
      "none",
    );

    // The page's hold button, which sends a status and no exception at all.
    expect(store.setOrderStatus(OPEN_CLEAN_C, "on-hold").status).toBe(
      "on-hold",
    );

    // And a clean order can still be shipped or cancelled outright.
    expect(store.setOrderStatus(OPEN_CLEAN_A, "fulfilled").status).toBe(
      "fulfilled",
    );
    expect(store.setOrderStatus(OPEN_CLEAN_B, "cancelled").status).toBe(
      "cancelled",
    );
  });

  it("will not pin a fresh exception onto a settled order", () => {
    // `setOrderException` is deliberately status-free, and CLEARING needs no
    // precondition — but SETTING one is the same already-settled class the
    // status writer refuses: it puts a shipped or cancelled order back into the
    // exception queue and back into the `valueAtRisk` KPI, by the one path that
    // does not consult the state machine.
    store.setOrderStatus(OPEN_CLEAN_A, "fulfilled");
    expect(() => store.setOrderException(OPEN_CLEAN_A, "oversell")).toThrow(
      "EXCEPTION_ON_SETTLED_ORDER",
    );
    expect(store.order(OPEN_CLEAN_A)?.exception).toBe("none");

    store.setOrderStatus(OPEN_CLEAN_B, "cancelled");
    expect(() =>
      store.setOrderException(OPEN_CLEAN_B, "carrier-delay"),
    ).toThrow("EXCEPTION_ON_SETTLED_ORDER");
    expect(store.order(OPEN_CLEAN_B)?.exception).toBe("none");

    // Clearing still works on any status — `"none"` is the one value every
    // status may legally hold — and so does the live-order case the Orders page
    // and beat 5 actually use.
    expect(store.setOrderException(OPEN_CLEAN_A, "none").exception).toBe(
      "none",
    );
    expect(store.setOrderException(OPEN_WITH_EXCEPTION, "none").exception).toBe(
      "none",
    );
    expect(
      store.setOrderException(OPEN_WITH_EXCEPTION, "oversell").exception,
    ).toBe("oversell");
  });

  it("leaves the terminal statuses with nowhere to go", () => {
    expect(store.ORDER_TRANSITIONS.fulfilled).toEqual([]);
    expect(store.ORDER_TRANSITIONS.cancelled).toEqual([]);
  });

  it("accepts every order the seed constructs", () => {
    // The seed materializes rows directly into state, so it bypasses the
    // machine entirely. Checking it against `isLegalOrderState` — the SAME
    // predicate the mutation enforces, not a second copy of the rule — is what
    // keeps a guard from quietly outlawing the demo's own starting data.
    const rows = store.orders();
    expect(rows.length).toBeGreaterThan(0);
    for (const o of rows) {
      expect(
        store.isLegalOrderState(o.status, o.exception),
        `seeded order ${o.number} is ${o.status} / ${o.exception}`,
      ).toBe(true);
      // Every seeded status must be one the table knows about.
      expect(store.ORDER_TRANSITIONS[o.status], o.number).toBeDefined();
    }
    // Not a vacuous pass: the seed really does contain settled rows (which must
    // therefore be exception-free) and exception-bearing rows.
    expect(rows.filter((o) => o.status === "fulfilled").length).toBeGreaterThan(
      0,
    );
    expect(rows.filter((o) => o.exception !== "none").length).toBeGreaterThan(
      0,
    );
  });
});

describe("BEAT 3d — the durable artifact", () => {
  it("files a plan into the store and truncates the model-authored arrays", () => {
    const before = store.plans().length;
    const plan = store.filePlan({
      vendor: "Kestrel Mills",
      season: "Autumn",
      summary: "Autumn knit buy.",
      highlights: ["a", "b", "c", "d"],
      lines: [
        {
          sku: "BW-CDR-HDY",
          name: "Cedar Hoodie",
          landedCost: 51,
          units: 1200,
        },
      ],
      schedule: [{ week: "Week 1", item: "PO countersigned" }],
      filedBy: "Nadia Okonjo",
    });
    expect(store.plans()).toHaveLength(before + 1);
    expect(plan.highlights).toHaveLength(3); // capped at three
    expect(store.plans()[0].id).toBe(plan.id); // newest first
  });
});

describe("reset", () => {
  it("puts every beat back, and leaves beat 6 gated again", () => {
    const waiver = store.openMarginWaiver(
      "promo-cedar",
      "VENDOR-FUND",
      "signed co-op",
    );
    store.finalizeMarginWaiver(waiver.id);
    store.approvePromotion("promo-cedar");
    store.issueRefund("ret-2210", 85);
    store.setOrderStatus("4471", "on-hold", "fraud-review");
    store.notifyCustomer("4471", "verification-required", "N");

    store.reset();

    expect(store.waivers()).toHaveLength(0);
    expect(store.notifications()).toHaveLength(0);
    expect(store.order("4471")?.status).toBe("open");
    expect(store.order("4471")?.notes).toHaveLength(0);
    expect(store.returns().find((r) => r.id === "ret-2210")?.status).toBe(
      "approved",
    );
    // The gate is armed again — this is what makes the demo re-runnable.
    expect(() => store.approvePromotion("promo-cedar")).toThrow(
      "BELOW_MARGIN_FLOOR",
    );
  });
});
