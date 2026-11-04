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
import { BOOKSTORE_CLUB, localCalendarDay } from "./club";
import { cartTotals } from "./query";
import type { CartPricing } from "./query";
import type {
  BookstoreData,
  CartLine,
  Order,
  Reminder,
  WriteResult,
} from "./types";

/** How long the add-to-cart highlight stays lit. Owned here, not by callers. */
export const HIGHLIGHT_MS = 2000;

/**
 * Cart and orders are scoped PER SHOPPER, so switching persona does not inherit
 * the other one's basket. Two people sharing one basket reads as a bug on stage.
 * (This is genuine per-shopper state, unlike durable MEMORY, which does not
 * re-scope on a switch — see intelligence/user-id.ts.)
 */
export const cartStorageKey = (shopperId: string) =>
  `bookstore.cart.${shopperId}`;
export const ordersStorageKey = (shopperId: string) =>
  `bookstore.orders.${shopperId}`;
/**
 * Everything else the store keeps — promo code, delivery date, store credit,
 * wishlist and reminders — under ONE additional key, so the two existing keys
 * keep their exact shape (a bare array each) rather than growing fields.
 */
export const extrasStorageKey = (shopperId: string) =>
  `bookstore.extras.${shopperId}`;

const BOOK_IDS = new Set(BOOKSTORE_BOOKS.map((b) => b.id));

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `isoDate` is well-formed AND names a real calendar date.
 *
 * A plain `new Date(...)` parse is not enough: `Date` ROLLS OVER an
 * out-of-range day instead of rejecting it (`2099-02-30` becomes
 * 2099-03-02), and the regex only bounds each field to two digits, so any
 * day-overflow within 01–31 (Feb 29/30/31 outside a leap year, the 31st of a
 * 30-day month) would otherwise slip through. Round-tripping the parsed date
 * back to `YYYY-MM-DD` and comparing against the input catches the rollover.
 */
function isValidIsoDate(isoDate: string): boolean {
  if (!ISO_DATE_RE.test(isoDate)) return false;
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === isoDate;
}

const EMPTY_WISHLIST: readonly string[] = Object.freeze([]);
const EMPTY_REMINDERS: readonly Reminder[] = Object.freeze([]);

/** What the store keeps — and the ONLY state that is ever persisted. */
interface CartState {
  cart: readonly CartLine[];
  orders: readonly Order[];
  /** Sibling of `cart`, not a field ON it — `cart` is `readonly CartLine[]`. */
  promoCode: string | null;
  deliverBy: string | null;
  storeCreditCents: number;
  wishlist: readonly string[];
  reminders: readonly Reminder[];
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
  promoCode: null,
  deliverBy: null,
  storeCreditCents: 0,
  wishlist: EMPTY_WISHLIST,
  reminders: EMPTY_REMINDERS,
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

function keepReminder(value: unknown): Reminder | null {
  if (typeof value !== "object" || value === null) return null;
  const { bookId, isoDate } = value as Partial<Reminder>;
  if (typeof bookId !== "string" || !BOOK_IDS.has(bookId)) return null;
  if (typeof isoDate !== "string" || !isValidIsoDate(isoDate)) return null;
  return { bookId, isoDate };
}

/** The extras fields, read back defensively — same discipline as `readJsonArray`. */
type ExtrasFields = Pick<
  CartState,
  "promoCode" | "deliverBy" | "storeCreditCents" | "wishlist" | "reminders"
>;

/**
 * The empty extras, as their OWN frozen value — not `EMPTY_STATE` (which is a
 * `CartState`, a strictly larger shape with `cart`/`orders` besides).
 * `readExtras`'s signature promises `ExtrasFields`; returning `EMPTY_STATE`
 * happened to type-check because `CartState` is structurally a superset, and
 * is safe TODAY only because `getSnapshot` spreads `readExtras`'s result
 * before its own explicit `cart`/`orders` keys, which win. Reorder those two
 * lines and the frozen empty arrays on `EMPTY_STATE` would silently clobber
 * the real reads. A dedicated `EMPTY_EXTRAS` removes that trap and gives
 * `readExtras` an `Object.is`-stable return of exactly its declared shape.
 */
const EMPTY_EXTRAS: ExtrasFields = Object.freeze({
  promoCode: null,
  deliverBy: null,
  storeCreditCents: 0,
  wishlist: EMPTY_WISHLIST,
  reminders: EMPTY_REMINDERS,
});

/**
 * Read the combined extras object defensively. Absent, corrupt, wrong-shape,
 * or a browser that throws on access all degrade to the empty defaults —
 * never to a thrown error on a page the presenter is standing in front of.
 * Each field is validated independently, so one bad field (e.g. a
 * hand-edited `storeCreditCents: "lots"`) does not blank the whole object.
 */
function readExtras(key: string): ExtrasFields {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY_EXTRAS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_EXTRAS;
    const obj = parsed as Record<string, unknown>;

    const promoCode = typeof obj.promoCode === "string" ? obj.promoCode : null;

    const deliverBy =
      typeof obj.deliverBy === "string" && isValidIsoDate(obj.deliverBy)
        ? obj.deliverBy
        : null;

    const storeCreditCents =
      typeof obj.storeCreditCents === "number" &&
      Number.isInteger(obj.storeCreditCents) &&
      obj.storeCreditCents >= 0
        ? obj.storeCreditCents
        : 0;

    const wishlist = Array.isArray(obj.wishlist)
      ? obj.wishlist.filter(
          (id): id is string => typeof id === "string" && BOOK_IDS.has(id),
        )
      : EMPTY_WISHLIST;

    const reminders = Array.isArray(obj.reminders)
      ? obj.reminders.map(keepReminder).filter((r): r is Reminder => r !== null)
      : EMPTY_REMINDERS;

    return { promoCode, deliverBy, storeCreditCents, wishlist, reminders };
  } catch {
    return EMPTY_EXTRAS;
  }
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
      ...readExtras(extrasStorageKey(shopperId)),
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
      if (
        value.promoCode !== current.promoCode ||
        value.deliverBy !== current.deliverBy ||
        value.storeCreditCents !== current.storeCreditCents ||
        value.wishlist !== current.wishlist ||
        value.reminders !== current.reminders
      ) {
        write(extrasStorageKey(shopperId), {
          promoCode: value.promoCode,
          deliverBy: value.deliverBy,
          storeCreditCents: value.storeCreditCents,
          wishlist: value.wishlist,
          reminders: value.reminders,
        });
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

  // The book-club run's second step. Refuses across works so the agent
  // cannot "swap" an unrelated book, refuses an unknown id, and refuses a
  // `fromBookId` that is not currently in the cart. On success the line is
  // replaced IN PLACE — same position, same qty — and `lastAddedId` moves to
  // the new id so the existing ~2s highlight ring fires on the changed row.
  const swapEdition = useCallback(
    (fromBookId: string, toBookId: string): WriteResult => {
      const fromBook = books.find((b) => b.id === fromBookId);
      const toBook = books.find((b) => b.id === toBookId);
      if (!fromBook) {
        return { ok: false, reason: `No book has the id "${fromBookId}".` };
      }
      if (!toBook) {
        return { ok: false, reason: `No book has the id "${toBookId}".` };
      }
      // Not-in-cart is checked BEFORE the self-swap no-op below. Checking
      // self-swap first would let `swapEdition(x, x)` return `{ ok: true }`
      // for a book that was never added to the cart — contradicting this
      // same function's own "not in the cart" refusal for every other pair.
      const current = store.getSnapshot();
      const line = current.cart.find((l) => l.bookId === fromBookId);
      if (!line) {
        return { ok: false, reason: "That book is not in the cart." };
      }
      // Swapping a book for itself is a no-op. Guarded BEFORE the same-work
      // check below (which would otherwise wrongly refuse a book with no
      // `workId` at all) and before the merge further down — a naive merge
      // would double `qty` by merging a line onto itself.
      if (fromBookId === toBookId) {
        return { ok: true };
      }
      if (!fromBook.workId || fromBook.workId !== toBook.workId) {
        return {
          ok: false,
          reason: "Those are not editions of the same work.",
        };
      }

      // If `toBookId` is ALREADY its own cart line (e.g. this stored
      // procedure replayed twice in one session), a plain `map` would leave
      // TWO lines sharing `toBookId` — duplicate keys on the cart page, and
      // `removeFromCart`/`addToCart` then acting on both at once. Merge into
      // the existing target line instead; otherwise replace in place as
      // before.
      store.update((live) => {
        const from = live.cart.find((l) => l.bookId === fromBookId);
        if (!from) return live;
        const hasTarget = live.cart.some((l) => l.bookId === toBookId);
        return {
          ...live,
          cart: hasTarget
            ? live.cart
                .filter((l) => l.bookId !== fromBookId)
                .map((l) =>
                  l.bookId === toBookId ? { ...l, qty: l.qty + from.qty } : l,
                )
            : live.cart.map((l) =>
                l.bookId === fromBookId ? { bookId: toBookId, qty: l.qty } : l,
              ),
        };
      });

      setLastAddedId(toBookId);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(
        () => setLastAddedId(null),
        HIGHLIGHT_MS,
      );

      return { ok: true };
    },
    [books, store],
  );

  // The book-club run's third step. Stores the CANONICAL code, never the
  // caller's casing, so the cart's `promoCode` always matches
  // `BOOKSTORE_CLUB.promoCode` exactly once applied.
  const applyPromoCode = useCallback(
    (code: string): WriteResult => {
      const trimmed = code.trim();
      if (
        !trimmed ||
        trimmed.toLowerCase() !== BOOKSTORE_CLUB.promoCode.toLowerCase()
      ) {
        return {
          ok: false,
          reason: `"${trimmed}" is not a code this shop accepts.`,
        };
      }
      store.update((current) => {
        if (current.promoCode === BOOKSTORE_CLUB.promoCode) return current;
        return { ...current, promoCode: BOOKSTORE_CLUB.promoCode };
      });
      return { ok: true };
    },
    [store],
  );

  // The book-club run's fourth step. Refuses anything that is not a
  // well-formed, real, present-or-future calendar date.
  const setDeliveryBy = useCallback(
    (isoDate: string): WriteResult => {
      if (!isValidIsoDate(isoDate)) {
        return {
          ok: false,
          reason: `"${isoDate}" is not a valid date. Use YYYY-MM-DD.`,
        };
      }
      const todayIso = localCalendarDay().toISOString().slice(0, 10);
      if (isoDate < todayIso) {
        return { ok: false, reason: "That date has already passed." };
      }
      store.update((current) => {
        if (current.deliverBy === isoDate) return current;
        return { ...current, deliverBy: isoDate };
      });
      return { ok: true };
    },
    [store],
  );

  // Distractor for `addToCart`: saves a book for later, real and visible on
  // the cart page, but never touches the cart or the total. Idempotent.
  const addToWishlist = useCallback(
    (bookId: string): WriteResult => {
      if (!BOOK_IDS.has(bookId)) {
        return { ok: false, reason: `No book has the id "${bookId}".` };
      }
      store.update((current) => {
        if (current.wishlist.includes(bookId)) return current;
        return { ...current, wishlist: [...current.wishlist, bookId] };
      });
      return { ok: true };
    },
    [store],
  );

  // Distractor for `setDeliveryBy`: reminds about a book on a date, but never
  // affects delivery. Replaces any existing reminder for the same book.
  const setReminder = useCallback(
    (bookId: string, isoDate: string): WriteResult => {
      if (!BOOK_IDS.has(bookId)) {
        return { ok: false, reason: `No book has the id "${bookId}".` };
      }
      if (!isValidIsoDate(isoDate)) {
        return { ok: false, reason: `"${isoDate}" is not a valid date.` };
      }
      store.update((current) => {
        // Same early return `addToWishlist` already has: re-setting an
        // identical reminder must not allocate a new array, rewrite storage,
        // notify every listener, or reorder the reminder to the end.
        const existing = current.reminders.find((r) => r.bookId === bookId);
        if (existing && existing.isoDate === isoDate) return current;
        return {
          ...current,
          reminders: [
            ...current.reminders.filter((r) => r.bookId !== bookId),
            { bookId, isoDate },
          ],
        };
      });
      return { ok: true };
    },
    [store],
  );

  // Distractor for `applyPromoCode`: real store credit, but it is NOT the
  // club discount. Sets (never accumulates) the amount.
  const applyStoreCredit = useCallback(
    (cents: number): WriteResult => {
      if (!Number.isInteger(cents) || cents < 0) {
        return {
          ok: false,
          reason: "Store credit must be a non-negative whole number of cents.",
        };
      }
      store.update((current) => {
        if (current.storeCreditCents === cents) return current;
        return { ...current, storeCreditCents: cents };
      });
      return { ok: true };
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
      const pricing: CartPricing = {
        club: BOOKSTORE_CLUB,
        promoCode: current.promoCode ?? undefined,
        storeCreditCents: current.storeCreditCents,
      };
      const order: Order = {
        // Sequential within a shopper, and derived from the persisted list, so
        // it survives a reload without colliding.
        id: String(1042 + current.orders.length),
        placedAt: new Date().toISOString(),
        lines: current.cart.map((l) => ({ ...l })),
        totalCents: cartTotals(books, current.cart, pricing).totalCents,
        // The ONLY card datum that exists past the CheckoutCard's own state.
        // Never the full number, never the CVV, never the expiry.
        last4,
      };
      store.update((live) => ({
        ...live,
        cart: EMPTY_STATE.cart,
        orders: [order, ...live.orders],
        // The club run's discount, the delivery date, and any store credit
        // belong to THIS order, not the next one — a fresh cart must not
        // silently keep last month's code, delivery date, or credit applied.
        // `storeCreditCents` is consumed exactly like `promoCode` on purpose:
        // it is equally sticky, agent-set, and price-affecting, so leaving it
        // would silently discount every later order in this persona.
        promoCode: null,
        deliverBy: null,
        storeCreditCents: 0,
      }));
      return order;
    },
    [books, store],
  );

  // Churn guard for the agent-context readables in tools.tsx: keyed on cart
  // and order IDENTITY, plus anything else that changes the PRICE or the
  // agent-visible cart (`promoCode`, `deliverBy`, `storeCreditCents`) —
  // never on the highlight flag or a timestamp, so a highlight tick cannot
  // re-register the agent's context. Deliberately excludes `wishlist` and
  // `reminders`: neither affects price or anything the cart readable already
  // reports, so a distractor write must not force a readable re-registration.
  const cartSignature = useMemo(
    () =>
      [
        state.cart.map((l) => `${l.bookId}x${l.qty}`).join(","),
        state.orders.map((o) => o.id).join(","),
        state.promoCode ?? "",
        state.deliverBy ?? "",
        String(state.storeCreditCents),
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
      promoCode: state.promoCode,
      deliverBy: state.deliverBy,
      storeCreditCents: state.storeCreditCents,
      // Not copied like `cart`/`orders`. `wishlist` is `readonly string[]` of
      // primitives, so there is nothing to mutate. `reminders` is `readonly
      // Reminder[]` whose `Reminder` fields are THEMSELVES `readonly` (types.ts) —
      // unlike `CartLine`'s, which is why `cart` must be copied and this does
      // not: `data.reminders[0].isoDate = "…"` fails to compile, so it cannot
      // mutate the cached snapshot behind `useSyncExternalStore`'s back.
      wishlist: state.wishlist,
      reminders: state.reminders,
      swapEdition,
      applyPromoCode,
      setDeliveryBy,
      addToWishlist,
      setReminder,
      applyStoreCredit,
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
      state.promoCode,
      state.deliverBy,
      state.storeCreditCents,
      state.wishlist,
      state.reminders,
      swapEdition,
      applyPromoCode,
      setDeliveryBy,
      addToWishlist,
      setReminder,
      applyStoreCredit,
    ],
  );
}
