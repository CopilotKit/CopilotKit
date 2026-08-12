import { describe, expect, it } from "vitest";
import { ESLint, Linter } from "eslint";
import { defaultSkinId, skinIdentities, skinIds } from "./skins-config";
import { allSkins, SkinRegistry } from "./registry";
import eslintConfig, {
  LINTED_SKIN_IDS,
  NAMED_SELECTORS,
} from "../../eslint.config.mjs";

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

describe("the resolved no-restricted-syntax selectors", () => {
  // ESLint flat-config `rules` OPTIONS ARE REPLACED, NOT MERGED: for a given rule
  // key the last block matching a file wins outright, so a later block silently
  // drops every selector it does not restate. That is not hypothetical — a beat-6
  // block listing only its own selector cost `src/skins/logistics/tools.tsx` all
  // three LOCK_SKIN selectors, and `pnpm lint` stayed green, the whole unit suite
  // stayed green, and the synthetic-link test above did not notice, because it
  // lints a MADE-UP snippet through a hand-picked block rather than asking what a
  // REAL FILE actually resolves to. It was caught by `eslint --print-config`, by
  // hand, once. This is that check, mechanised.
  //
  // WHY `calculateConfigForFile` AND NOT A WALK OF THE EXPORTED ARRAY. The bug IS
  // the resolution order. Re-implementing "last matching block wins" here would
  // re-implement the very thing that must be verified, and any walk that models
  // replacement correctly is just a worse copy of ESLint's own resolver. This
  // calls the resolver.
  //
  // ASSERT THE LIST, NEVER A COUNT. The prose comments in `eslint.config.mjs` used
  // to prescribe counts, and they had already rotted when read ("any other in-skin
  // file: three"; `actions.ts` resolves to two). A count also cannot say WHICH
  // selector went missing. Selectors are named via `NAMED_SELECTORS` — the rule's
  // own option schema is `additionalProperties: false` over `{ selector, message }`,
  // so a `name` key on the option object itself is a hard config error.
  const nameOf = (selector: string) =>
    Object.entries(NAMED_SELECTORS).find(
      ([, option]) => option.selector === selector,
    )?.[0] ?? `UNNAMED(${selector})`;

  // Every file whose selector set is deliberately different from its neighbours'.
  // Widening a rule's `files` glob (beat 2 for keel, then airline; beat 6 as each
  // gate lands) means updating a row here — that edit is the point.
  it.each([
    [
      "src/skins/logistics/tools.tsx",
      [
        "literalSkinPrefix",
        "templateLeadingPrefix",
        "interpolationThenSlash",
        "withheldGateVocabulary",
        "statusKeyedTerminalRender",
      ],
    ],
    [
      "src/skins/logistics/agent.ts",
      [
        "literalSkinPrefix",
        "templateLeadingPrefix",
        "interpolationThenSlash",
        "withheldGateVocabulary",
        "statusKeyedTerminalRender",
      ],
    ],
    // Any other logistics .tsx — pages and components carry beat 2 but not beat 6.
    [
      "src/skins/logistics/pages/control-tower.tsx",
      [
        "literalSkinPrefix",
        "templateLeadingPrefix",
        "interpolationThenSlash",
        "statusKeyedTerminalRender",
      ],
    ],
    // The other two skins that now ship a withheld gate vocabulary. Both gained
    // beat 2 AND beat 6 in the beat-parity work, so both agent-facing files
    // resolve to the full five, exactly as logistics does.
    [
      "src/skins/airline/tools.tsx",
      [
        "literalSkinPrefix",
        "templateLeadingPrefix",
        "interpolationThenSlash",
        "withheldGateVocabulary",
        "statusKeyedTerminalRender",
      ],
    ],
    [
      "src/skins/airline/agent.ts",
      [
        "literalSkinPrefix",
        "templateLeadingPrefix",
        "interpolationThenSlash",
        "withheldGateVocabulary",
        "statusKeyedTerminalRender",
      ],
    ],
    [
      "src/skins/keel/tools.tsx",
      [
        "literalSkinPrefix",
        "templateLeadingPrefix",
        "interpolationThenSlash",
        "withheldGateVocabulary",
        "statusKeyedTerminalRender",
      ],
    ],
    [
      "src/skins/keel/agent.ts",
      [
        "literalSkinPrefix",
        "templateLeadingPrefix",
        "interpolationThenSlash",
        "withheldGateVocabulary",
        "statusKeyedTerminalRender",
      ],
    ],
    // The human filing FORMS are deliberately OUTSIDE the beat-6 block: each one
    // legitimately imports its skin's label map, because the operator reads it and
    // the agent learns the code by WATCHING them choose one. A withheld catalogue
    // with no form is an unlearnable gate. They still carry beat 2.
    [
      "src/skins/airline/components/fare-exception-form.tsx",
      [
        "literalSkinPrefix",
        "templateLeadingPrefix",
        "interpolationThenSlash",
        "statusKeyedTerminalRender",
      ],
    ],
    [
      "src/skins/keel/components/variance-form.tsx",
      [
        "literalSkinPrefix",
        "templateLeadingPrefix",
        "interpolationThenSlash",
        "statusKeyedTerminalRender",
      ],
    ],
    // A skin beat 2 has NOT reached: it must not gain the selector early, or the
    // tree goes red for a phase that has not run. Banking and people are the
    // remaining two.
    [
      "src/skins/banking/tools.tsx",
      ["literalSkinPrefix", "templateLeadingPrefix", "interpolationThenSlash"],
    ],
    // The REST/data layer legitimately drops the builder-concat selector.
    [
      "src/skins/logistics/actions.ts",
      ["literalSkinPrefix", "templateLeadingPrefix"],
    ],
  ])(
    "%s resolves to exactly its expected selectors",
    async (file, expected) => {
      const resolved = await new ESLint().calculateConfigForFile(file);
      const entry = resolved.rules?.["no-restricted-syntax"];
      expect(Array.isArray(entry)).toBe(true);
      const [, ...selectors] = entry as [string, ...{ selector: string }[]];
      expect(selectors.map((option) => nameOf(option.selector))).toEqual(
        expected,
      );
    },
  );
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
