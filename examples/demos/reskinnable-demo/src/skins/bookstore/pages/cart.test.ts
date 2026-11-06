import { describe, expect, it } from "vitest";
import { cartTotals } from "@/skins/bookstore/data/query";
import { BOOKSTORE_CLUB } from "@/skins/bookstore/data/club";
import { BOOKSTORE_BOOKS } from "@/skins/bookstore/data/seed";
import { splitCartDiscount } from "./cart";

/**
 * Beat 5's most-scrutinised second: `cartTotals` returns one scalar
 * `discountCents`, so the club-plus-credit case cannot be rendered under a
 * single label without misattributing one source's money to the other.
 * `splitCartDiscount` is the honest split; these cases are exactly the ones
 * named in the cart-page brief (club only, credit only, both, neither, and a
 * credit that exceeds the subtotal), each proving `clubPart + creditPart ===
 * discountCents`.
 */
describe("splitCartDiscount", () => {
  // bk-003: Trust hardcover, 2699 cents.
  const cart = [{ bookId: "bk-003", qty: 1 }];
  const subtotalCents = cartTotals(BOOKSTORE_BOOKS, cart).subtotalCents;

  it("attributes the whole discount to the club when store credit is zero", () => {
    const { discountCents } = cartTotals(BOOKSTORE_BOOKS, cart, {
      club: BOOKSTORE_CLUB,
      promoCode: BOOKSTORE_CLUB.promoCode,
      storeCreditCents: 0,
    });
    const { clubPart, creditPart } = splitCartDiscount(
      BOOKSTORE_BOOKS,
      cart,
      subtotalCents,
      discountCents,
      BOOKSTORE_CLUB.promoCode,
    );
    expect(clubPart).toBe(405); // round(2699 * 0.15)
    expect(creditPart).toBe(0);
    expect(clubPart + creditPart).toBe(discountCents);
  });

  it("attributes the whole discount to store credit when no promo code is set", () => {
    const { discountCents } = cartTotals(BOOKSTORE_BOOKS, cart, {
      storeCreditCents: 500,
    });
    const { clubPart, creditPart } = splitCartDiscount(
      BOOKSTORE_BOOKS,
      cart,
      subtotalCents,
      discountCents,
      undefined,
    );
    expect(clubPart).toBe(0);
    expect(creditPart).toBe(500);
    expect(clubPart + creditPart).toBe(discountCents);
  });

  it("splits correctly across both sources — the case the single-label row misattributes", () => {
    const { discountCents } = cartTotals(BOOKSTORE_BOOKS, cart, {
      club: BOOKSTORE_CLUB,
      promoCode: BOOKSTORE_CLUB.promoCode,
      storeCreditCents: 500,
    });
    const { clubPart, creditPart } = splitCartDiscount(
      BOOKSTORE_BOOKS,
      cart,
      subtotalCents,
      discountCents,
      BOOKSTORE_CLUB.promoCode,
    );
    expect(clubPart).toBe(405);
    expect(creditPart).toBe(500);
    expect(clubPart + creditPart).toBe(discountCents);
  });

  it("splits to nothing when neither source applies", () => {
    const { discountCents } = cartTotals(BOOKSTORE_BOOKS, cart);
    const { clubPart, creditPart } = splitCartDiscount(
      BOOKSTORE_BOOKS,
      cart,
      subtotalCents,
      discountCents,
      undefined,
    );
    expect(clubPart).toBe(0);
    expect(creditPart).toBe(0);
    expect(clubPart + creditPart).toBe(discountCents);
    expect(discountCents).toBe(0);
  });

  it("clamps when combined credit and club discount would exceed the subtotal, and never renders a third bucket", () => {
    const { discountCents, totalCents } = cartTotals(BOOKSTORE_BOOKS, cart, {
      club: BOOKSTORE_CLUB,
      promoCode: BOOKSTORE_CLUB.promoCode,
      storeCreditCents: 999_999,
    });
    const { clubPart, creditPart } = splitCartDiscount(
      BOOKSTORE_BOOKS,
      cart,
      subtotalCents,
      discountCents,
      BOOKSTORE_CLUB.promoCode,
    );
    expect(discountCents).toBe(subtotalCents);
    expect(totalCents).toBe(0);
    expect(clubPart).toBe(405); // the club's own share is unaffected by the clamp
    expect(creditPart).toBe(subtotalCents - 405); // credit absorbs the overage
    expect(clubPart).toBeGreaterThanOrEqual(0);
    expect(creditPart).toBeGreaterThanOrEqual(0);
    expect(clubPart + creditPart).toBe(discountCents);
  });
});
