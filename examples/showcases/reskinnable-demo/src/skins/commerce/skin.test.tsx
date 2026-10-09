import { describe, expect, it } from "vitest";

import commerce from "@/skins/commerce/skin";
import { OrdersPage } from "@/skins/commerce/pages/orders";
import { CatalogPage } from "@/skins/commerce/pages/catalog";
import { PromotionsPage } from "@/skins/commerce/pages/promotions";
import { ReturnsPage } from "@/skins/commerce/pages/returns";

/**
 * `resolvePage` maps URL segments (untrusted caller input) to a page. A plain
 * object indexed by the joined segments walks the prototype chain, so these keys
 * all resolve to a truthy `Function` (or, for `__proto__`, `Object.prototype`)
 * that slips past the shell's `if (!Page) notFound()` guard in
 * `src/app/[skin]/[[...rest]]/page.tsx` and is rendered as a `ComponentType` —
 * a 500 instead of a 404. The `Map`-backed lookup must return `null` for every
 * one. Mirrors `src/skins/keel/skin.test.tsx`.
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

describe("commerce resolvePage", () => {
  it("resolves every real page segment to its component", () => {
    expect(commerce.resolvePage([])).toBe(OrdersPage);
    expect(commerce.resolvePage(["orders"])).toBe(OrdersPage);
    expect(commerce.resolvePage(["catalog"])).toBe(CatalogPage);
    expect(commerce.resolvePage(["promotions"])).toBe(PromotionsPage);
    expect(commerce.resolvePage(["returns"])).toBe(ReturnsPage);
  });

  it("covers every nav segment, so no nav entry can 404", () => {
    for (const route of commerce.nav) {
      expect(
        commerce.resolvePage(route.segment ? [route.segment] : []),
      ).not.toBeNull();
    }
  });

  it("returns null (404) for an unknown segment", () => {
    expect(commerce.resolvePage(["nope"])).toBeNull();
    expect(commerce.resolvePage(["orders", "extra"])).toBeNull();
  });

  it.each(PROTOTYPE_CHAIN_KEYS)(
    "returns null (404) for prototype-chain key %j, never a Function component",
    (key) => {
      expect(commerce.resolvePage([key])).toBeNull();
    },
  );
});
