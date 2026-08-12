import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ShopperProvider, useShopper } from "../providers";
import { localCalendarDay, nextMeetingISO } from "./club";
import type { WriteResult } from "./types";
import {
  HIGHLIGHT_MS,
  cartStorageKey,
  extrasStorageKey,
  ordersStorageKey,
  useBookstoreData,
} from "./use-data";

/**
 * Installs a `Date` whose zero-argument form (`new Date()` — the shape
 * `localCalendarDay()`'s default parameter uses internally) returns a
 * stand-in reporting only the LOCAL `getFullYear`/`getMonth`/`getDate` this
 * fix reads, per the same contract `club.test.ts` uses: reading any other
 * property throws loudly rather than silently passing. Any OTHER `new
 * Date(arg)` call (e.g. `isValidIsoDate`'s ISO parse) is forwarded to the
 * real constructor untouched, so nothing else in the store is disturbed.
 *
 * Deliberately not `vi.setSystemTime`: that pins the UTC instant, not the
 * timezone, so it cannot make a local calendar day disagree with UTC's — the
 * exact disagreement this test exists to exercise. Restores the prior
 * `Date` global on return; caller must invoke the returned `restore()`.
 */
function installFakeLocalToday(year: number, month: number, date: number) {
  const PriorDate = globalThis.Date;
  const stub = {
    getFullYear: () => year,
    getMonth: () => month,
    getDate: () => date,
  };
  const FakeDate = new Proxy(PriorDate, {
    construct(target, args) {
      if (args.length === 0) return stub as unknown as Date;
      return Reflect.construct(target, args);
    },
  });
  globalThis.Date = FakeDate as unknown as DateConstructor;
  return () => {
    globalThis.Date = PriorDate;
  };
}

function Probe() {
  const data = useBookstoreData();
  // Captures the `reason` of the most recent book-club/distractor write, so a
  // test can assert on WHY a write was refused without each button needing
  // its own testid.
  const [lastReason, setLastReason] = useState("");
  const run = (fn: () => WriteResult) => setLastReason(fn().reason ?? "");

  return (
    <div>
      <span data-testid="books">{data.books.length}</span>
      <span data-testid="cart">{JSON.stringify(data.cart)}</span>
      <span data-testid="orders">{data.orders.length}</span>
      <span data-testid="last-added">{data.lastAddedId ?? ""}</span>
      <span data-testid="signature">{data.cartSignature}</span>
      <span data-testid="last-reason">{lastReason}</span>
      <span data-testid="promo">{data.promoCode ?? ""}</span>
      <span data-testid="deliver-by">{data.deliverBy ?? ""}</span>
      <span data-testid="wishlist">{data.wishlist.length}</span>
      <span data-testid="reminders">{data.reminders.length}</span>
      <span data-testid="credit">{data.storeCreditCents}</span>
      <button onClick={() => data.addToCart("bk-005")}>add small things</button>
      <button onClick={() => data.addToCart("bk-005", 2)}>add two more</button>
      <button onClick={() => data.addToCart("bk-999")}>add unknown</button>
      <button onClick={() => data.removeFromCart("bk-005")}>remove</button>
      <button onClick={() => data.placeOrder("4242")}>place</button>
      <button onClick={() => data.addToCart("bk-003")}>
        add trust hardcover
      </button>
      <button onClick={() => run(() => data.swapEdition("bk-003", "bk-025"))}>
        swap to paperback
      </button>
      <button onClick={() => run(() => data.swapEdition("bk-003", "bk-012"))}>
        swap to unrelated
      </button>
      <button onClick={() => run(() => data.swapEdition("bk-003", "bk-003"))}>
        swap to same edition
      </button>
      <button onClick={() => run(() => data.setDeliveryBy("2099-02-29"))}>
        set delivery feb29 non-leap
      </button>
      <button onClick={() => run(() => data.setDeliveryBy("2099-04-31"))}>
        set delivery apr31 rollover
      </button>
      <button onClick={() => run(() => data.applyPromoCode("CLUB15"))}>
        apply club code
      </button>
      <button onClick={() => run(() => data.applyPromoCode("WRONG99"))}>
        apply wrong code
      </button>
      <button onClick={() => run(() => data.setDeliveryBy("2099-01-01"))}>
        set delivery future
      </button>
      <button onClick={() => run(() => data.setDeliveryBy("2000-01-01"))}>
        set delivery past
      </button>
      <button onClick={() => run(() => data.setDeliveryBy("not-a-date"))}>
        set delivery garbage
      </button>
      <button
        onClick={() =>
          run(() => data.setDeliveryBy(nextMeetingISO(4, localCalendarDay())))
        }
      >
        set delivery club meeting
      </button>
      <button onClick={() => run(() => data.addToWishlist("bk-003"))}>
        wishlist trust
      </button>
      <button
        onClick={() => run(() => data.setReminder("bk-003", "2099-01-01"))}
      >
        remind trust
      </button>
      <button onClick={() => run(() => data.applyStoreCredit(500))}>
        credit 500
      </button>
    </div>
  );
}

/**
 * Adds a persona switch, so one case can prove the store re-keys per shopper.
 * Exposes all five extras fields (not just `cart`) so the switch guard is
 * proven for `promoCode`, `deliverBy`, `storeCreditCents`, `wishlist`, and
 * `reminders` too, not just the cart.
 */
function SwitchProbe() {
  const { setShopperId } = useShopper();
  const data = useBookstoreData();
  return (
    <div>
      <span data-testid="cart">{JSON.stringify(data.cart)}</span>
      <span data-testid="extras">
        {JSON.stringify({
          promoCode: data.promoCode,
          deliverBy: data.deliverBy,
          storeCreditCents: data.storeCreditCents,
          wishlist: data.wishlist,
          reminders: data.reminders,
        })}
      </span>
      <button onClick={() => setShopperId("guest")}>to guest</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <ShopperProvider>
      <Probe />
    </ShopperProvider>,
  );

const click = (label: string) => act(() => screen.getByText(label).click());

const cart = (): unknown =>
  JSON.parse(screen.getByTestId("cart").textContent ?? "null");

const extras = (): unknown =>
  JSON.parse(screen.getByTestId("extras").textContent ?? "null");

const readStored = (key: string): unknown =>
  JSON.parse(window.localStorage.getItem(key) ?? "null");

describe("useBookstoreData", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("exposes the whole catalog", () => {
    renderProbe();
    expect(screen.getByTestId("books").textContent).toBe("25");
  });

  it("starts with an empty cart and no orders", () => {
    renderProbe();
    expect(cart()).toEqual([]);
    expect(screen.getByTestId("orders").textContent).toBe("0");
  });

  it("adds a line", () => {
    renderProbe();
    click("add small things");
    expect(cart()).toEqual([{ bookId: "bk-005", qty: 1 }]);
  });

  it("increments quantity instead of duplicating the line", () => {
    renderProbe();
    click("add small things");
    click("add two more");
    expect(cart()).toEqual([{ bookId: "bk-005", qty: 3 }]);
  });

  it("refuses a book that is not in the catalog", () => {
    renderProbe();
    click("add unknown");
    expect(cart()).toEqual([]);
  });

  it("removes a line outright", () => {
    renderProbe();
    click("add small things");
    click("remove");
    expect(cart()).toEqual([]);
  });

  it("sets lastAddedId and clears it after the highlight window", () => {
    renderProbe();
    click("add small things");
    expect(screen.getByTestId("last-added").textContent).toBe("bk-005");
    act(() => void vi.advanceTimersByTime(HIGHLIGHT_MS + 10));
    expect(screen.getByTestId("last-added").textContent).toBe("");
  });

  it("mirrors the cart to localStorage under the shopper's key", () => {
    renderProbe();
    click("add small things");
    expect(readStored(cartStorageKey("maya"))).toEqual([
      { bookId: "bk-005", qty: 1 },
    ]);
  });

  it("rehydrates a persisted cart — the beat-2 reload", () => {
    window.localStorage.setItem(
      cartStorageKey("maya"),
      JSON.stringify([{ bookId: "bk-012", qty: 2 }]),
    );
    renderProbe();
    expect(cart()).toEqual([{ bookId: "bk-012", qty: 2 }]);
  });

  it("survives corrupt persisted state rather than crashing the page", () => {
    window.localStorage.setItem(cartStorageKey("maya"), "{not json");
    renderProbe();
    expect(cart()).toEqual([]);
  });

  it("degrades to empty when the persisted value is the wrong shape", () => {
    // A non-array — e.g. a hand-edited key, or a value written by an older
    // shape of this store. Must not throw on a page a presenter is in front of.
    window.localStorage.setItem(
      cartStorageKey("maya"),
      JSON.stringify({ bookId: "bk-005", qty: 1 }),
    );
    renderProbe();
    expect(cart()).toEqual([]);
  });

  it("drops persisted lines whose book left the catalog", () => {
    window.localStorage.setItem(
      cartStorageKey("maya"),
      JSON.stringify([
        { bookId: "bk-999", qty: 1 },
        { bookId: "bk-005", qty: 1 },
      ]),
    );
    renderProbe();
    expect(cart()).toEqual([{ bookId: "bk-005", qty: 1 }]);
  });

  it("places an order, empties the cart, and persists the order", () => {
    renderProbe();
    click("add small things");
    click("place");
    expect(cart()).toEqual([]);
    expect(screen.getByTestId("orders").textContent).toBe("1");
    const stored = readStored(ordersStorageKey("maya")) as Record<
      string,
      unknown
    >[];
    expect(stored).toHaveLength(1);
    expect(stored[0].last4).toBe("4242");
    expect(stored[0].totalCents).toBe(1400);
    expect(stored[0].lines).toEqual([{ bookId: "bk-005", qty: 1 }]);
  });

  it("never stores anything but last4 on an order", () => {
    renderProbe();
    click("add small things");
    click("place");
    const raw = window.localStorage.getItem(ordersStorageKey("maya")) ?? "";
    expect(raw).toContain("4242");
    const [order] = JSON.parse(raw) as Record<string, unknown>[];
    expect(Object.keys(order).sort()).toEqual([
      "id",
      "last4",
      "lines",
      "placedAt",
      "totalCents",
    ]);
  });

  it("changes cartSignature when the cart changes", () => {
    renderProbe();
    const before = screen.getByTestId("signature").textContent;
    click("add small things");
    expect(screen.getByTestId("signature").textContent).not.toBe(before);
  });

  it("re-keys to the other shopper's basket on a persona switch", () => {
    // The store is created with `useMemo` keyed on `shopper.id` precisely so
    // this works; a `useState` lazy initialiser would pin Maya's basket forever
    // and Guest would inherit it, which reads as a bug on stage.
    window.localStorage.setItem(
      cartStorageKey("maya"),
      JSON.stringify([{ bookId: "bk-005", qty: 1 }]),
    );
    window.localStorage.setItem(
      cartStorageKey("guest"),
      JSON.stringify([{ bookId: "bk-012", qty: 3 }]),
    );
    render(
      <ShopperProvider>
        <SwitchProbe />
      </ShopperProvider>,
    );
    expect(cart()).toEqual([{ bookId: "bk-005", qty: 1 }]);
    click("to guest");
    expect(cart()).toEqual([{ bookId: "bk-012", qty: 3 }]);
  });

  it("re-keys the extras fields (not just the cart) on a persona switch", () => {
    window.localStorage.setItem(
      cartStorageKey("maya"),
      JSON.stringify([{ bookId: "bk-005", qty: 1 }]),
    );
    window.localStorage.setItem(
      extrasStorageKey("maya"),
      JSON.stringify({
        promoCode: "CLUB15",
        deliverBy: "2099-01-01",
        storeCreditCents: 500,
        wishlist: ["bk-003"],
        reminders: [{ bookId: "bk-003", isoDate: "2099-01-01" }],
      }),
    );
    window.localStorage.setItem(
      cartStorageKey("guest"),
      JSON.stringify([{ bookId: "bk-012", qty: 3 }]),
    );
    window.localStorage.setItem(
      extrasStorageKey("guest"),
      JSON.stringify({
        promoCode: null,
        deliverBy: null,
        storeCreditCents: 0,
        wishlist: [],
        reminders: [],
      }),
    );
    render(
      <ShopperProvider>
        <SwitchProbe />
      </ShopperProvider>,
    );
    expect(extras()).toEqual({
      promoCode: "CLUB15",
      deliverBy: "2099-01-01",
      storeCreditCents: 500,
      wishlist: ["bk-003"],
      reminders: [{ bookId: "bk-003", isoDate: "2099-01-01" }],
    });
    click("to guest");
    expect(extras()).toEqual({
      promoCode: null,
      deliverBy: null,
      storeCreditCents: 0,
      wishlist: [],
      reminders: [],
    });
  });

  it("leaves cartSignature untouched when the highlight clears", () => {
    // The readables in tools.tsx memoize on this string. If it moved with the
    // highlight, every add-to-cart would re-register the agent's context ~2s
    // later, for no change in what the agent can see.
    renderProbe();
    click("add small things");
    const withHighlight = screen.getByTestId("signature").textContent;
    act(() => void vi.advanceTimersByTime(HIGHLIGHT_MS + 10));
    expect(screen.getByTestId("last-added").textContent).toBe("");
    expect(screen.getByTestId("signature").textContent).toBe(withHighlight);
  });
});

describe("book club writes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("swapEdition replaces a line with the other edition, preserving quantity", () => {
    renderProbe();
    click("add trust hardcover"); // bk-003, qty 2 via two clicks
    click("add trust hardcover");
    click("swap to paperback"); // bk-003 -> bk-025
    expect(cart()).toEqual([{ bookId: "bk-025", qty: 2 }]);
  });

  it("swapEdition refuses two books that are not the same work", () => {
    renderProbe();
    click("add trust hardcover");
    click("swap to unrelated"); // bk-003 -> bk-012
    expect(cart()).toEqual([{ bookId: "bk-003", qty: 1 }]);
    expect(screen.getByTestId("last-reason").textContent).toMatch(/same work/i);
  });

  it("swapEdition refuses when the source line is not in the cart", () => {
    renderProbe();
    click("swap to paperback");
    expect(cart()).toEqual([]);
    expect(screen.getByTestId("last-reason").textContent).toMatch(
      /not in the cart/i,
    );
  });

  it("swapEdition merges into an existing target line rather than duplicating it", () => {
    // F1: replaying the stored procedure twice in one session without
    // emptying the cart used to leave TWO lines sharing `toBookId`.
    renderProbe();
    click("add trust hardcover"); // bk-003 x1
    click("swap to paperback"); // -> [{bk-025, 1}]
    click("add trust hardcover"); // -> [{bk-025, 1}, {bk-003, 1}]
    click("swap to paperback"); // -> merges into ONE line
    expect(cart()).toEqual([{ bookId: "bk-025", qty: 2 }]);
  });

  it("swapEdition(x, x) is an ok no-op that does not double qty", () => {
    renderProbe();
    click("add trust hardcover"); // bk-003 x1
    click("swap to same edition"); // bk-003 -> bk-003
    expect(cart()).toEqual([{ bookId: "bk-003", qty: 1 }]);
  });

  it("swapEdition(x, x) refuses when the book is not in the cart", () => {
    // The not-in-cart check must run BEFORE the self-swap no-op, or this
    // would wrongly return `{ ok: true }` for a cart line that never existed.
    renderProbe();
    click("swap to same edition"); // bk-003 -> bk-003, cart is empty
    expect(cart()).toEqual([]);
    expect(screen.getByTestId("last-reason").textContent).toMatch(
      /not in the cart/i,
    );
  });

  it("applyPromoCode stores the club code and rejects others", () => {
    renderProbe();
    click("apply club code");
    expect(screen.getByTestId("promo").textContent).toBe("CLUB15");
    click("apply wrong code");
    expect(screen.getByTestId("promo").textContent).toBe("CLUB15"); // unchanged
    expect(screen.getByTestId("last-reason").textContent).toMatch(
      /not a code/i,
    );
  });

  it("applyPromoCode matches the code case-insensitively", () => {
    renderProbe();
    act(() => {
      screen.getByText("apply club code").click();
    });
    expect(screen.getByTestId("promo").textContent).toBe("CLUB15");
  });

  it("setDeliveryBy accepts a future date and rejects a past or malformed one", () => {
    renderProbe();
    click("set delivery future");
    expect(screen.getByTestId("deliver-by").textContent).toBe("2099-01-01");
    click("set delivery past");
    expect(screen.getByTestId("deliver-by").textContent).toBe("2099-01-01");
    click("set delivery garbage");
    expect(screen.getByTestId("deliver-by").textContent).toBe("2099-01-01");
  });

  it("setDeliveryBy accepts tonight's club meeting when local time is already the next UTC day", () => {
    // Thursday 2026-08-13, 17:00 at UTC-8 — already Friday in UTC. The old
    // UTC-derived "today" would compute 2026-08-14 and refuse the club's own
    // same-day meeting date (2026-08-13) as past; the local-calendar fix
    // agrees with itself instead.
    const restore = installFakeLocalToday(2026, 7, 13); // August is month 7
    try {
      renderProbe();
      click("set delivery club meeting");
      expect(screen.getByTestId("deliver-by").textContent).toBe("2026-08-13");
      expect(screen.getByTestId("last-reason").textContent).toBe("");
    } finally {
      restore();
    }
  });

  it("setDeliveryBy refuses a rollover date — Feb 29 in a non-leap year", () => {
    // F4: `new Date(...)` rolls this over to March 2nd instead of returning
    // `NaN`, so a naive parse would have accepted it.
    renderProbe();
    click("set delivery feb29 non-leap"); // 2099 is not a leap year
    expect(screen.getByTestId("deliver-by").textContent).toBe("");
    expect(screen.getByTestId("last-reason").textContent).toMatch(
      /not a valid date/i,
    );
  });

  it("setDeliveryBy refuses a rollover date — the 31st of a 30-day month", () => {
    renderProbe();
    click("set delivery apr31 rollover"); // April has 30 days
    expect(screen.getByTestId("deliver-by").textContent).toBe("");
    expect(screen.getByTestId("last-reason").textContent).toMatch(
      /not a valid date/i,
    );
  });

  it("the distractors write real state", () => {
    renderProbe();
    click("wishlist trust");
    click("remind trust");
    click("credit 500");
    expect(screen.getByTestId("wishlist").textContent).toBe("1");
    expect(screen.getByTestId("reminders").textContent).toBe("1");
    expect(screen.getByTestId("credit").textContent).toBe("500");
  });

  it("addToWishlist is idempotent on a duplicate", () => {
    renderProbe();
    click("wishlist trust");
    click("wishlist trust");
    expect(screen.getByTestId("wishlist").textContent).toBe("1");
  });

  it("round-trips every new field through localStorage", () => {
    renderProbe();
    click("apply club code");
    click("set delivery future");
    click("wishlist trust");
    const raw = window.localStorage.getItem(extrasStorageKey("maya"))!;
    const parsed = JSON.parse(raw);
    expect(parsed.promoCode).toBe("CLUB15");
    expect(parsed.deliverBy).toBe("2099-01-01");
    expect(parsed.wishlist).toEqual(["bk-003"]);
  });

  it("degrades to defaults on corrupt extras", () => {
    window.localStorage.setItem(extrasStorageKey("maya"), "{not json");
    renderProbe();
    expect(screen.getByTestId("promo").textContent).toBe("");
    expect(screen.getByTestId("wishlist").textContent).toBe("0");
  });

  it("degrades to defaults when the persisted extras are the wrong shape", () => {
    window.localStorage.setItem(
      extrasStorageKey("maya"),
      JSON.stringify([1, 2, 3]),
    );
    renderProbe();
    expect(screen.getByTestId("promo").textContent).toBe("");
    expect(screen.getByTestId("deliver-by").textContent).toBe("");
    expect(screen.getByTestId("wishlist").textContent).toBe("0");
    expect(screen.getByTestId("reminders").textContent).toBe("0");
    expect(screen.getByTestId("credit").textContent).toBe("0");
  });

  it("validates each extras field independently — one bad field does not blank the rest", () => {
    // F5: unlike the wrong-TOP-LEVEL-shape case above (which exercises the
    // all-defaults path), this persists a well-shaped object with ONE bad
    // field per case alongside good ones, proving independence.
    window.localStorage.setItem(
      extrasStorageKey("maya"),
      JSON.stringify({
        promoCode: "CLUB15",
        deliverBy: "not-a-date",
        storeCreditCents: "lots",
        wishlist: ["bk-003"],
        reminders: "nope",
      }),
    );
    renderProbe();
    expect(screen.getByTestId("promo").textContent).toBe("CLUB15");
    expect(screen.getByTestId("deliver-by").textContent).toBe("");
    expect(screen.getByTestId("credit").textContent).toBe("0");
    expect(screen.getByTestId("wishlist").textContent).toBe("1");
    expect(screen.getByTestId("reminders").textContent).toBe("0");
  });

  it("drops a persisted reminder whose book left the catalog", () => {
    window.localStorage.setItem(
      extrasStorageKey("maya"),
      JSON.stringify({
        promoCode: null,
        deliverBy: null,
        storeCreditCents: 0,
        wishlist: ["bk-999", "bk-003"],
        reminders: [{ bookId: "bk-999", isoDate: "2099-01-01" }],
      }),
    );
    renderProbe();
    // The unknown id is dropped from the wishlist; the known one survives.
    expect(screen.getByTestId("wishlist").textContent).toBe("1");
    expect(screen.getByTestId("reminders").textContent).toBe("0");
  });

  it("cartSignature changes with the promo code — the readables must re-register", () => {
    renderProbe();
    const before = screen.getByTestId("signature").textContent;
    click("apply club code");
    expect(screen.getByTestId("signature").textContent).not.toBe(before);
  });

  it("cartSignature does NOT change when the wishlist/reminder distractors write", () => {
    // Neither affects price or the cart, so firing them must not force the
    // agent-context readables to re-register.
    renderProbe();
    const before = screen.getByTestId("signature").textContent;
    click("wishlist trust");
    click("remind trust");
    expect(screen.getByTestId("signature").textContent).toBe(before);
  });

  it("cartSignature DOES change when store credit is applied", () => {
    // Unlike the wishlist/reminder distractors, store credit changes the
    // price, so it must reach the readables.
    renderProbe();
    const before = screen.getByTestId("signature").textContent;
    click("credit 500");
    expect(screen.getByTestId("signature").textContent).not.toBe(before);
  });

  it("placeOrder clears promoCode, deliverBy and storeCreditCents, and totals the discounted price", () => {
    // F2: store credit is equally sticky, agent-set, and price-affecting as
    // the promo code, so it must be consumed by the order too — otherwise
    // every later order in this persona is silently discounted.
    renderProbe();
    click("add trust hardcover"); // bk-003, 2699
    click("apply club code"); // CLUB15 -> 15% off -> discount 405
    click("credit 500"); // store credit 500
    click("place");
    expect(screen.getByTestId("promo").textContent).toBe("");
    expect(screen.getByTestId("deliver-by").textContent).toBe("");
    expect(screen.getByTestId("credit").textContent).toBe("0");
    const stored = JSON.parse(
      window.localStorage.getItem(ordersStorageKey("maya")) ?? "[]",
    ) as Record<string, unknown>[];
    expect(stored[0].totalCents).toBe(1794);
  });
});
