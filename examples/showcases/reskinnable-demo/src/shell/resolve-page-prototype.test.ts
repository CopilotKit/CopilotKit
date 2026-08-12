/**
 * Every registered skin's `resolvePage` must return null for a segment that
 * happens to name an Object.prototype member.
 *
 * WHY THIS EXISTS. The obvious implementation is an object literal plus a
 * nullish coalesce:
 *
 *     const PAGES: Record<string, ComponentType> = { "": Index, cards: Cards };
 *     const resolvePage = (s) => PAGES[s.join("/")] ?? null;
 *
 * That is wrong in a way nothing else in the tree catches. An object literal
 * inherits Object.prototype, so `PAGES["constructor"]` is a truthy Function and
 * the `?? null` never fires. `src/app/[skin]/[[...rest]]/page.tsx` then does:
 *
 *     const Page = skin.resolvePage(rest ?? []);
 *     if (!Page) notFound();
 *     return <Page />;
 *
 * `!Page` is false, so `notFound()` is skipped and React is handed a value that
 * is not a component. `/banking/constructor` answers 500 where it owes 404 --
 * and the same for toString, valueOf, hasOwnProperty, __proto__ and the rest.
 *
 * The failure is invisible to every other gate. It type-checks (the Record's
 * index signature says ComponentType), it lints, and no test that walks the
 * REAL segments will ever pass a prototype key. Three shipped skins carried it
 * for several releases; it was found by hand while wiring a fourth.
 *
 * The fix each skin applies is a Map, which has no prototype keys, so the
 * nullish coalesce becomes the only gate needed. This test does not care HOW a
 * skin fixes it -- an object plus `Object.hasOwn` would pass too. It pins the
 * BEHAVIOUR, so it keeps holding for skins that do not exist yet.
 */
import { describe, expect, it } from "vitest";
import { SkinRegistry } from "./registry";

/**
 * Every enumerable and non-enumerable own key of Object.prototype, taken from
 * the prototype itself rather than hand-listed -- a hand-list silently stops
 * covering the surface it is guarding the moment a runtime adds a member.
 * `__proto__` is an accessor here and resolves to Object.prototype (truthy),
 * which is exactly the shape that defeats `?? null`.
 */
const PROTOTYPE_KEYS = Object.getOwnPropertyNames(Object.prototype);

/**
 * The VALUES those keys resolve to, which is what the assertion actually tests.
 *
 * "Returns null for a prototype key" is the wrong property, and this test
 * asserted it at first and was wrong about keel. Keel resolves
 * `knowledge/<docId>` for ANY docId on purpose and renders an in-page
 * not-found body rather than a 404 -- so a non-null answer to
 * `["knowledge", "constructor"]` is correct behaviour there, not a leak.
 *
 * The property that actually matters is narrower: resolvePage must never hand
 * the router something it INHERITED. A real page component is fine whatever
 * the segment; `Object.prototype.constructor` is not.
 */
const PROTOTYPE_VALUES = new Set<unknown>(
  PROTOTYPE_KEYS.map(
    (key) => Object.getOwnPropertyDescriptor(Object.prototype, key)?.value,
  ).filter((value) => value !== undefined),
);

/** `__proto__` is an accessor whose getter returns the prototype object itself. */
const leaksPrototype = (value: unknown) =>
  value === Object.prototype || PROTOTYPE_VALUES.has(value);

const skins = Object.entries(SkinRegistry);

describe("resolvePage is not fooled by Object.prototype keys", () => {
  it("registers at least the six shipped skins, so the loop below is not vacuous", () => {
    // Without this, deleting the registry's contents would turn every
    // assertion below into a no-op and the suite would still be green.
    expect(skins.length).toBeGreaterThanOrEqual(6);
    expect(PROTOTYPE_KEYS).toContain("constructor");
    expect(PROTOTYPE_KEYS).toContain("toString");
  });

  for (const [id, skin] of skins) {
    it(`${id} never returns an inherited member for a prototype-named segment`, () => {
      const leaked = PROTOTYPE_KEYS.filter((key) =>
        leaksPrototype(skin.resolvePage([key])),
      );
      expect(leaked).toEqual([]);
    });

    it(`${id} never returns an inherited member for a NESTED prototype-named segment`, () => {
      // A prototype key can arrive as the second segment too, and a skin that
      // key-joins its segments before looking up is exposed on both shapes.
      // Keel legitimately resolves a real page here (parameterized routes), so
      // this asserts non-inheritance rather than nullness.
      const leaked = PROTOTYPE_KEYS.filter((key) =>
        leaksPrototype(skin.resolvePage(["knowledge", key])),
      );
      expect(leaked).toEqual([]);
    });

    it(`${id} still resolves its own index`, () => {
      // The companion assertion. Without it, a resolvePage that returned null
      // for EVERYTHING would pass every test above while serving a dead skin.
      expect(skin.resolvePage([])).not.toBeNull();
    });
  }
});
