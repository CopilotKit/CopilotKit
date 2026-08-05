import { describe, expect, it } from "vitest";
import { defaultSkinId, skinIdentities, skinIds } from "./skins-config";
import { allSkins, SkinRegistry } from "./registry";

describe("skinIds", () => {
  // `skins-config.ts` must stay free of skin imports so server components can
  // read it without dragging client skin modules into an RSC. That forces the id
  // list to be duplicated here rather than derived — so this test is the thing
  // that stops the copy from rotting. A fifth skin added to the registry and not
  // to `skinIds` fails HERE, instead of silently rejecting LOCK_SKIN=<newskin>.
  it("lists exactly the registered skins, in registry order", () => {
    expect([...skinIds]).toEqual(Object.keys(SkinRegistry));
  });

  it("names the skin `defaultSkinId` points at", () => {
    // Otherwise `/` would redirect to a skin the LOCK_SKIN validator rejects.
    expect(skinIds).toContain(defaultSkinId);
  });
});

describe("skinIdentities", () => {
  // Same rationale as `skinIds`: `skins-config.ts` stays import-free, so the
  // root layout's `generateMetadata` can resolve BOTH the locked tab title
  // (brand) and its unfurl description (tagline) without pulling a client skin
  // module into an RSC. That forces `skinIdentities` to be a hand-copied
  // duplicate of each skin's `identity.brand` and `identity.tagline` — and THIS
  // is the test that stops the copy from rotting. A renamed brand or tagline (or
  // a fifth skin) that is not mirrored here fails HERE, instead of silently
  // shipping a stale tab title or a contradicting unfurl description.
  it("matches every registered skin's identity.brand and identity.tagline", () => {
    expect(skinIdentities).toEqual(
      Object.fromEntries(
        allSkins().map((s) => [
          s.id,
          { brand: s.identity.brand, tagline: s.identity.tagline },
        ]),
      ),
    );
  });
});
