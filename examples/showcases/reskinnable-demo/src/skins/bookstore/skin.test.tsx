import { describe, expect, it } from "vitest";

import bookstore from "@/skins/bookstore/skin";
import { BrowsePage } from "@/skins/bookstore/pages/browse";
import { BookPage } from "@/skins/bookstore/pages/book";
import { CartPage } from "@/skins/bookstore/pages/cart";

/**
 * `resolvePage` maps URL segments (untrusted caller input) to a page. A plain
 * object indexed by `segments[0]` walks the prototype chain, so these keys all
 * resolve to a truthy `Function` that slips past the `?? null` 404 guard and is
 * handed to the shell as a `ComponentType` — a React crash instead of a 404.
 * The `Map`-backed lookup must return `null` (a clean 404) for every one.
 */
const PROTOTYPE_CHAIN_KEYS = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
  "__defineGetter__",
];

describe("bookstore resolvePage", () => {
  it("resolves the known single-segment routes to their page", () => {
    expect(bookstore.resolvePage([])).toBe(BrowsePage);
    expect(bookstore.resolvePage(["browse"])).toBe(BrowsePage);
    expect(bookstore.resolvePage(["cart"])).toBe(CartPage);
  });

  it("resolves the parameterized book route without an existence check", () => {
    expect(bookstore.resolvePage(["book", "kairos"])).toBe(BookPage);
    expect(bookstore.resolvePage(["book", "does-not-exist"])).toBe(BookPage);
  });

  it("returns null (404) for an unknown single segment", () => {
    expect(bookstore.resolvePage(["nope"])).toBeNull();
  });

  it("returns null (404) for unknown or too-deep parameterized routes", () => {
    expect(bookstore.resolvePage(["unknown", "x"])).toBeNull();
    expect(bookstore.resolvePage(["book", "a", "b"])).toBeNull();
  });

  it.each(PROTOTYPE_CHAIN_KEYS)(
    "returns null (404) for prototype-chain key %j, never a Function component",
    (key) => {
      expect(bookstore.resolvePage([key])).toBeNull();
    },
  );
});
