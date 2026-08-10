import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ShopperProvider, useShopper } from "../providers";
import {
  HIGHLIGHT_MS,
  cartStorageKey,
  ordersStorageKey,
  useBookstoreData,
} from "./use-data";

function Probe() {
  const data = useBookstoreData();
  return (
    <div>
      <span data-testid="books">{data.books.length}</span>
      <span data-testid="cart">{JSON.stringify(data.cart)}</span>
      <span data-testid="orders">{data.orders.length}</span>
      <span data-testid="last-added">{data.lastAddedId ?? ""}</span>
      <span data-testid="signature">{data.cartSignature}</span>
      <button onClick={() => data.addToCart("bk-005")}>add small things</button>
      <button onClick={() => data.addToCart("bk-005", 2)}>add two more</button>
      <button onClick={() => data.addToCart("bk-999")}>add unknown</button>
      <button onClick={() => data.removeFromCart("bk-005")}>remove</button>
      <button onClick={() => data.placeOrder("4242")}>place</button>
    </div>
  );
}

/** Adds a persona switch, so one case can prove the store re-keys per shopper. */
function SwitchProbe() {
  const { setShopperId } = useShopper();
  const data = useBookstoreData();
  return (
    <div>
      <span data-testid="cart">{JSON.stringify(data.cart)}</span>
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
    expect(screen.getByTestId("books").textContent).toBe("24");
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
    // and Guest would inherit it, collapsing the memory beat's contrast.
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
