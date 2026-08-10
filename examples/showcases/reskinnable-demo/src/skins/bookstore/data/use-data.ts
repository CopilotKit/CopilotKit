"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useShopper } from "@/skins/bookstore/providers";
import { BOOKSTORE_BOOKS } from "./seed";
import { cartTotals } from "./query";
import type { BookstoreData, CartLine, Order } from "./types";

/** How long the add-to-cart highlight stays lit. Owned here, not by callers. */
export const HIGHLIGHT_MS = 2000;

/**
 * Cart and orders are scoped PER SHOPPER, so switching persona does not inherit
 * the other one's basket — the memory beat is a clean contrast or it is nothing.
 */
export const cartStorageKey = (shopperId: string) =>
  `bookstore.cart.${shopperId}`;
export const ordersStorageKey = (shopperId: string) =>
  `bookstore.orders.${shopperId}`;

const BOOK_IDS = new Set(BOOKSTORE_BOOKS.map((b) => b.id));

/** What the store keeps — and the ONLY state that is ever persisted. */
interface CartState {
  cart: readonly CartLine[];
  orders: readonly Order[];
}

/**
 * The empty snapshot, as ONE module-level frozen value.
 *
 * This is load-bearing, not tidiness: `getServerSnapshot` must return a value
 * that is `Object.is`-stable across calls. A fresh `{ cart: [], orders: [] }`
 * per call fails that check and React infinite-loops during hydration. Frozen so
 * an accidental push into the shared empty cart fails loudly here instead of
 * silently seeding every later snapshot.
 */
const EMPTY_STATE: CartState = Object.freeze({
  cart: Object.freeze([]) as readonly CartLine[],
  orders: Object.freeze([]) as readonly Order[],
});

/**
 * Read persisted JSON defensively. `localStorage` is user-writable and outlives
 * seed changes, so every failure mode here — absent, corrupt, wrong shape, a
 * book that no longer exists, or a browser that throws on access at all — must
 * degrade to "empty", never to a thrown error on a page the presenter is
 * standing in front of.
 */
function readJsonArray<T>(
  key: string,
  keep: (value: unknown) => T | null,
): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(keep).filter((v): v is T => v !== null);
  } catch {
    return [];
  }
}

function keepCartLine(value: unknown): CartLine | null {
  if (typeof value !== "object" || value === null) return null;
  const { bookId, qty } = value as Partial<CartLine>;
  if (typeof bookId !== "string" || !BOOK_IDS.has(bookId)) return null;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) return null;
  return { bookId, qty };
}

function keepOrder(value: unknown): Order | null {
  if (typeof value !== "object" || value === null) return null;
  const order = value as Partial<Order>;
  if (typeof order.id !== "string") return null;
  if (typeof order.last4 !== "string") return null;
  if (typeof order.totalCents !== "number") return null;
  if (typeof order.placedAt !== "string") return null;
  if (!Array.isArray(order.lines)) return null;
  const lines = order.lines
    .map(keepCartLine)
    .filter((l): l is CartLine => l !== null);
  return {
    id: order.id,
    placedAt: order.placedAt,
    totalCents: order.totalCents,
    last4: order.last4,
    lines,
  };
}

/**
 * A tiny external store over `localStorage`, consumed via
 * `useSyncExternalStore` — the same shape as the shell's
 * `createPreferencesStore` (src/shell/layout/layout-preferences.tsx) and this
 * skin's own `createShopperStore` (../providers.tsx).
 *
 * Why not `useState` + a hydration effect: writing state from an effect is a
 * lint error here (`react-hooks/set-state-in-effect`) and a cascading-render
 * hazard, and reading storage from a `useState` lazy initialiser instead makes
 * the server and client markup disagree. `useSyncExternalStore` is the
 * sanctioned way to read an external system, and `getServerSnapshot` gives SSR a
 * defined value, so React reconciles to the client snapshot without a mismatch.
 *
 * There is deliberately NO `hydrated` flag and NO write effect. The first
 * snapshot is read FROM storage and storage is only ever written inside
 * `update`, so the bug a flag would have guarded — a mount-time effect
 * clobbering the persisted cart with `[]` — is unrepresentable here.
 *
 * The mirror is load-bearing for beat 2: the proof of a durable thread is a HARD
 * RELOAD mid-demo, and an in-memory-only cart empties at exactly that moment —
 * so the audience reads the reload as having broken the app rather than as
 * having proved anything. The books array is never persisted; it is static seed.
 */
function createBookstoreStore(shopperId: string) {
  // Cached because `getSnapshot` must return an `Object.is`-stable value between
  // commits. `cart` and `orders` are ARRAYS, so re-parsing storage per call
  // would hand React a new reference every time and loop it.
  let snapshot: CartState | null = null;
  const listeners = new Set<() => void>();

  function getSnapshot(): CartState {
    if (snapshot) return snapshot;
    snapshot = {
      cart: readJsonArray(cartStorageKey(shopperId), keepCartLine),
      orders: readJsonArray(ordersStorageKey(shopperId), keepOrder),
    };
    return snapshot;
  }

  function write(key: string, value: unknown) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Privacy-mode browsers throw on access. A cart that does not survive a
      // reload is a degraded demo; a thrown error is a dead page.
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot,
    /** SSR has no storage, so the server always renders the empty basket. */
    getServerSnapshot(): CartState {
      return EMPTY_STATE;
    },
    /**
     * The ONLY mutation path: read the cached snapshot → compute the next one →
     * cache it → write through to storage → notify. Returning the same object
     * is a no-op, so a remove-that-removes-nothing does not re-render or
     * rewrite storage. Only the keys that actually changed are written.
     */
    update(next: (current: CartState) => CartState) {
      const current = getSnapshot();
      const value = next(current);
      if (value === current) return;
      snapshot = value;
      if (value.cart !== current.cart) {
        write(cartStorageKey(shopperId), value.cart);
      }
      if (value.orders !== current.orders) {
        write(ordersStorageKey(shopperId), value.orders);
      }
      for (const listener of listeners) listener();
    },
  };
}

/**
 * The skin's `useData`. The catalog is the frozen seed; the cart and the orders
 * are an external store mirrored to `localStorage`, per shopper.
 *
 * Nothing here ever mutates a `Book`: `Object.freeze` on the seed is SHALLOW and
 * `readonly Book[]` does not make the fields readonly, so a stray
 * `book.priceCents = …` would both compile and succeed, permanently, for every
 * later reader in the session. Copy, never mutate.
 */
export function useBookstoreData(): BookstoreData {
  const { shopper } = useShopper();
  const books = BOOKSTORE_BOOKS;

  // `useMemo`, NOT `useState(createStore)`: the store is keyed on `shopper.id`,
  // which changes at runtime on a persona switch, and a lazy `useState`
  // initialiser would pin the first shopper's store — and therefore the first
  // shopper's basket — forever. `useMemo` is safe precisely because
  // `localStorage` is the source of truth: a spurious re-creation only re-reads
  // storage, and `useSyncExternalStore` re-subscribes when `subscribe`'s
  // identity changes. Deliberately NOT a module-level `Map` of stores, which
  // would leak one test's (or one mount's) cached snapshot into the next.
  const store = useMemo(() => createBookstoreStore(shopper.id), [shopper.id]);

  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  // The highlight timer is owned HERE so every surface that draws the highlight
  // (cart line, browse card, nav badge) reads one flag and none of them needs
  // its own effect. Cleared on unmount so a fast navigation cannot leave a timer
  // writing into an unmounted tree. Cleanup-only, so it sets no state on mount.
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  const addToCart = useCallback(
    (bookId: string, qty = 1) => {
      // Refuse unknown ids and nonsense quantities rather than storing them:
      // `addToCart` is reachable from the AGENT, so an invented id must not be
      // able to put a phantom line in the basket that the cart page would then
      // have to render around — and a non-integer qty would persist a line that
      // `keepCartLine` drops on the next reload, i.e. a basket that quietly
      // changes across the demo's reload.
      if (!BOOK_IDS.has(bookId)) return;
      if (!Number.isInteger(qty) || qty < 1) return;

      store.update((current) => {
        const existing = current.cart.find((l) => l.bookId === bookId);
        return {
          ...current,
          cart: existing
            ? current.cart.map((l) =>
                l.bookId === bookId ? { ...l, qty: l.qty + qty } : l,
              )
            : [...current.cart, { bookId, qty }],
        };
      });

      setLastAddedId(bookId);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(
        () => setLastAddedId(null),
        HIGHLIGHT_MS,
      );
    },
    [store],
  );

  const removeFromCart = useCallback(
    (bookId: string) => {
      store.update((current) => {
        const cart = current.cart.filter((l) => l.bookId !== bookId);
        if (cart.length === current.cart.length) return current;
        return { ...current, cart };
      });
    },
    [store],
  );

  const placeOrder = useCallback(
    (last4: string): Order => {
      // Built from the store's CURRENT snapshot rather than from a render-time
      // closure, so the order this returns is exactly the order that commits —
      // and so the callback identity does not change with every cart edit (a
      // changing identity tears down the checkout tool mid-call).
      const current = store.getSnapshot();
      const order: Order = {
        // Sequential within a shopper, and derived from the persisted list, so
        // it survives a reload without colliding.
        id: String(1042 + current.orders.length),
        placedAt: new Date().toISOString(),
        lines: current.cart.map((l) => ({ ...l })),
        totalCents: cartTotals(books, current.cart).totalCents,
        // The ONLY card datum that exists past the CheckoutCard's own state.
        // Never the full number, never the CVV, never the expiry.
        last4,
      };
      store.update((live) => ({
        cart: EMPTY_STATE.cart,
        orders: [order, ...live.orders],
      }));
      return order;
    },
    [books, store],
  );

  // Churn guard for the agent-context readables in tools.tsx: keyed only on cart
  // and order IDENTITY, never on the highlight flag or a timestamp, so a
  // highlight tick cannot re-register the agent's context.
  const cartSignature = useMemo(
    () =>
      [
        state.cart.map((l) => `${l.bookId}x${l.qty}`).join(","),
        state.orders.map((o) => o.id).join(","),
      ].join("|"),
    [state],
  );

  // Handed out as copies: `BookstoreData` declares mutable arrays, and the
  // store's snapshot must stay exactly what was written to storage — a consumer
  // sorting `data.cart` in place must not be able to edit the cached snapshot
  // behind `useSyncExternalStore`'s back. Recomputed only when the snapshot
  // changes, so identities are still stable across ordinary re-renders.
  const cart = useMemo(() => state.cart.map((l) => ({ ...l })), [state]);
  const orders = useMemo(
    () =>
      state.orders.map((o) => ({
        ...o,
        lines: o.lines.map((l) => ({ ...l })),
      })),
    [state],
  );

  return useMemo<BookstoreData>(
    () => ({
      books,
      cart,
      orders,
      addToCart,
      removeFromCart,
      placeOrder,
      lastAddedId,
      cartSignature,
    }),
    [
      books,
      cart,
      orders,
      addToCart,
      removeFromCart,
      placeOrder,
      lastAddedId,
      cartSignature,
    ],
  );
}
