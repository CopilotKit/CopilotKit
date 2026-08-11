// Pure config — no skin/component imports, so server components (e.g. the
// index redirect and the LOCK_SKIN validator) can read it without pulling
// client skin modules into RSC.
export const defaultSkinId = "banking";

// The registered skin ids, duplicated from `registry.ts` on purpose: this module
// must stay import-free for the server contexts above, and `registry.ts` pulls in
// four client skin modules. `skins-config.test.ts` asserts the two stay in sync,
// so the duplication cannot drift silently. Keep in registry order.
export const skinIds = [
  "banking",
  "airline",
  "logistics",
  "keel",
  "people",
  "vantage",
] as const;

// Skin id → { brand, tagline }, duplicated from each skin's `identity.brand`
// and `identity.tagline` for the same reason as `skinIds`: the root layout's
// `generateMetadata` is a server component that must resolve BOTH the locked
// deploy's tab title (brand) and its unfurl description (tagline) without
// importing a client skin module. One map carries both fields so the two never
// drift apart. Values are copied verbatim from src/skins/<id>/identity.*;
// `skins-config.test.ts` asserts this map matches the registry so it cannot drift.
export const skinIdentities: Record<
  (typeof skinIds)[number],
  { brand: string; tagline: string }
> = {
  banking: {
    brand: "Northwind Finance",
    tagline: "Collaborative finance for 21st century teams",
  },
  airline: {
    brand: "Aeronova",
    tagline: "Your journey, concierge-managed from gate to gate.",
  },
  logistics: {
    brand: "Meridian",
    tagline: "Every exception, decided.",
  },
  keel: {
    brand: "Keel",
    tagline: "Harbor Point Health — knowledge and operations desk",
  },
  people: {
    brand: "Rowan",
    tagline: "The people operations desk.",
  },
  vantage: {
    brand: "Vantage",
    tagline: "Your numbers, read for you.",
  },
};
