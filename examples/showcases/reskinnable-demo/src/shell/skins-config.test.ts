import { describe, expect, it } from "vitest";
import { Linter } from "eslint";
import { defaultSkinId, skinIdentities, skinIds } from "./skins-config";
import { allSkins, SkinRegistry } from "./registry";
import eslintConfig, { LINTED_SKIN_IDS } from "../../eslint.config.mjs";

describe("skinIds", () => {
  // `skins-config.ts` must stay free of skin imports so server components can
  // read it without dragging client skin modules into an RSC. That forces the id
  // list to be duplicated here rather than derived — so this test is the thing
  // that stops the copy from rotting. Any skin added to the registry and not to
  // `skinIds` fails HERE, instead of silently rejecting LOCK_SKIN=<newskin>.
  it("lists exactly the registered skins, in registry order", () => {
    expect([...skinIds]).toEqual(Object.keys(SkinRegistry));
  });

  it("names the skin `defaultSkinId` points at", () => {
    // Otherwise `/` would redirect to a skin the LOCK_SKIN validator rejects.
    expect(skinIds).toContain(defaultSkinId);
  });
});

describe("the LOCK_SKIN lint guard", () => {
  // `eslint.config.mjs` hand-copies the skin id list into the `no-restricted-syntax`
  // selectors that enforce the LOCK_SKIN URL contract (it cannot import `skinIds`
  // — see the comment on `LINTED_SKIN_IDS`). That copy rots SILENTLY: it named
  // only the first four skins for two releases after `people` and `commerce`
  // shipped, so a hardcoded `"/commerce/orders"` href passed `pnpm lint` while
  // breaking the address bar on a locked deploy. CLAUDE.md and the reskin skill
  // both promise `pnpm lint` "fails and names your file" for exactly that href,
  // so the omission falsified documented behaviour with nothing to catch it.
  //
  // These two tests are that catch. The first pins the list; the second proves
  // the SELECTORS actually fire, so a refactor that keeps the list but breaks the
  // regexes fails too.
  const skinSourceBlock = eslintConfig.find(
    (block) =>
      Array.isArray(block.files) && block.files.includes("src/skins/**/*.tsx"),
  );
  const restrictedSyntax = skinSourceBlock?.rules?.["no-restricted-syntax"];

  it("guards exactly the registered skins", () => {
    expect(LINTED_SKIN_IDS).toEqual([...skinIds]);
  });

  it("reports a hardcoded skin route prefix in every registered skin", () => {
    expect(Array.isArray(restrictedSyntax)).toBe(true);
    const linter = new Linter();
    // Both hardcoding shapes the selectors are meant to catch: a bare literal and
    // a template whose first quasi opens with the prefix. Plain JS on purpose —
    // the selectors match shape, not types, so the default parser suffices.
    const unguarded = skinIds.flatMap((id) =>
      [
        `router.push("/${id}/orders");`,
        `router.push(\`/${id}/orders/\${orderId}\`);`,
      ].filter(
        (code) =>
          linter.verify(code, {
            rules: {
              "no-restricted-syntax": restrictedSyntax as Linter.RuleEntry,
            },
            languageOptions: { ecmaVersion: "latest", sourceType: "module" },
          }).length === 0,
      ),
    );
    expect(unguarded).toEqual([]);
  });
});

describe("skinIdentities", () => {
  // Same rationale as `skinIds`: `skins-config.ts` stays import-free, so the
  // root layout's `generateMetadata` can resolve BOTH the locked tab title
  // (brand) and its unfurl description (tagline) without pulling a client skin
  // module into an RSC. That forces `skinIdentities` to be a hand-copied
  // duplicate of each skin's `identity.brand` and `identity.tagline` — and THIS
  // is the test that stops the copy from rotting. A renamed brand or tagline (or
  // a newly registered skin) that is not mirrored here fails HERE, instead of
  // silently shipping a stale tab title or a contradicting unfurl description.
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
