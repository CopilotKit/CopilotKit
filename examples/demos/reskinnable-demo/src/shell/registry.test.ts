import { describe, expect, it } from "vitest";
import { getSkin, SkinRegistry, allSkins } from "./registry";

/**
 * `getSkin`'s ONLY caller passes the `[skin]` dynamic URL segment
 * (`src/app/[skin]/layout.tsx`), so its argument is attacker-chosen: anyone can
 * type `/constructor`. The registry is a plain object, so a plain
 * `SkinRegistry[id]` lookup walks the PROTOTYPE CHAIN — `"constructor"`,
 * `"toString"`, `"valueOf"`, `"hasOwnProperty"`, `"__proto__"` all resolve to a
 * truthy inherited member, sail past the layout's `if (!skin) notFound()`, and
 * then blow up on `skin.identity.favicon` a few lines later. A 500 (with a stack
 * trace) where the framework's own 404 belongs.
 *
 * The repo already treats this as a real hazard rather than a curiosity for the
 * same reason: every `src/skins/-/intelligence/user-id.ts` (with `-` as the glob
 * star — a literal one before a slash would close this comment) uses a `Map` for
 * its untrusted-key lookups, with the rationale written out at length in
 * `src/skins/exec/intelligence/user-id.ts`. This suite holds `getSkin` to the
 * same standard, and pins the lookup by BEHAVIOUR (own keys resolve, inherited
 * members do not) rather than by which own-key primitive implements it.
 */
describe("getSkin", () => {
  it("resolves every registered skin by its own id", () => {
    for (const [id, skin] of Object.entries(SkinRegistry)) {
      expect(getSkin(id), `getSkin("${id}")`).toBe(skin);
    }
  });

  it("does not resolve Object.prototype members as skins", () => {
    // Every one of these is a real, reachable URL: `/constructor`,
    // `/toString`, … The `__proto__` entry is the nastiest — a plain lookup
    // returns `Object.prototype` itself, an object, so even a `typeof === "object"`
    // guard downstream would wave it through.
    const inherited = [
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
    for (const key of inherited) {
      expect(getSkin(key), `getSkin("${key}") must not resolve`).toBeNull();
    }
  });

  it("returns null for an unregistered id and for no id at all", () => {
    expect(getSkin("not-a-skin")).toBeNull();
    expect(getSkin(undefined)).toBeNull();
    expect(getSkin("")).toBeNull();
  });

  it("lists exactly the registered skins", () => {
    expect(allSkins()).toEqual(Object.values(SkinRegistry));
  });
});
