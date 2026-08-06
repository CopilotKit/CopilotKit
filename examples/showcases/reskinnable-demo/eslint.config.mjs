import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * The LOCK_SKIN URL contract, enforced against the AST — NOT by scanning source
 * as text (see the deleted `src/shell/skin-path.drift.test.ts`; a regex over raw
 * source is a re-implementation of a fragment of a JS parser, and drifted out of
 * true three review rounds running). ESLint already has the parser; these are
 * `no-restricted-syntax` selectors over the real tree.
 *
 * THE INVARIANT. Under a `LOCK_SKIN` deploy the app is served AT `/`, so no
 * in-skin navigation target may embed a skin route prefix or produce a leading
 * `//`. Every in-skin href must go through `useSkinHref(skin.id)` / the skin's own
 * helper (keel's `useKeelHref`), which drop the prefix (returning `/`) on a lock.
 * See `src/shell/skin-path.ts` and `src/proxy.ts` for the two halves.
 *
 * WHY AST, NOT USE-SITE. An AST rule fires on the LITERAL SHAPE wherever it
 * appears — `router.push(...)`, `href={...}`, `location.assign(...)`, or anywhere
 * else — so it needs no list of call sites, and it never trips on a path that only
 * appears inside a comment or string of prose (the two false positives the text
 * scanner kept producing). It also cannot be fooled by a `$` in a variable name.
 */

// Route id segments. Keep in sync with `src/shell/skins-config.ts` `skinIds`.
const SKIN_IDS = "banking|airline|logistics|keel";

const FIX_HINT =
  "Build the link through useSkinHref(skin.id) — or the skin's own helper, e.g. " +
  "keel's useKeelHref() — so the tenant segment drops under LOCK_SKIN. Never " +
  "hardcode a skin route prefix or hand-concatenate onto a builder result. " +
  "See src/shell/skin-path.ts.";

// (i) A string-literal path that OPENS with a skin id segment: "/banking/cards",
// "/keel". A mid-path id (`/api/banking/v1/...`) does not match — it must be the
// first segment.
const literalSkinPrefix = {
  selector: `Literal[value=/^\\/(${SKIN_IDS})(\\/|$)/]`,
  message: `In-skin link hardcodes a literal skin route prefix. ${FIX_HINT}`,
};

// (i)+(iii) A template literal whose FIRST quasi opens with a skin id segment
// (`` `/keel/runs/${id}` ``) or is a lone leading slash before an interpolation
// (`` `/${skin.id}/…` ``, `` `/${anything}/…` `` — a prefix built from any
// id-holding expression). A REST literal like `` `/api/logistics/${x}` `` does not
// match: its first quasi is `/api/logistics/`, neither a skin id nor a lone `/`.
const templateLeadingPrefix = {
  selector: `TemplateLiteral > TemplateElement:first-child[value.raw=/^\\/(${SKIN_IDS})(\\/|$)|^\\/$/]`,
  message: `In-skin link opens a template with a skin route prefix. ${FIX_HINT}`,
};

// (ii) An interpolation immediately followed by `/` (`` `${base}/charges` ``) —
// appending a path onto a builder result, which emits a protocol-relative `//`
// under a lock (base is "/" there). Any quasi that is NOT the first and opens with
// `/` means "an interpolation was immediately followed by `/`". This is the shape
// that shipped. It is scoped OFF for the REST/data layer below, whose `${apiBase}/…`
// concatenation targets a server URL the lock never rewrites.
const interpolationThenSlash = {
  selector: `TemplateLiteral > TemplateElement:not(:first-child)[value.raw=/^\\//]`,
  message: `In-skin link concatenates a path onto an interpolated base, yielding a leading "//" under a lock. ${FIX_HINT}`,
};

// Skin tests render bare (no LockedSkinProvider), so they legitimately ASSERT on
// the unlocked, prefixed hrefs (`toBe("/banking/charges")`). Exempt them — the
// contract is about what a skin SHIPS, not what a test expects of unlocked output.
const SKIN_TEST_FILES = ["src/skins/**/*.test.ts", "src/skins/**/*.test.tsx"];

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // The E2E LOCK_SKIN server's build dir (NEXT_DIST_DIR in
      // playwright.config.ts). Must be listed alongside `.next/**` — ESLint has
      // its own ignore list and does not read .gitignore, so without this a
      // single E2E run leaves generated output that `pnpm lint` then reports
      // tens of thousands of problems in.
      ".next-locked/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  // LOCK_SKIN URL contract — every in-skin source.
  {
    files: ["src/skins/**/*.ts", "src/skins/**/*.tsx"],
    ignores: SKIN_TEST_FILES,
    rules: {
      "no-restricted-syntax": [
        "error",
        literalSkinPrefix,
        templateLeadingPrefix,
        interpolationThenSlash,
      ],
    },
  },
  // The REST/data layer (`actions.ts`, `intelligence/**`) builds ABSOLUTE SERVER
  // urls by concatenating onto an API base — `` `${BASE}/shipments` ``,
  // `` `${base}/api/memories` ``. That `${apiBase}/…` shape is legitimate and
  // lock-agnostic (the proxy never rewrites `/api/**`), so drop the
  // builder-result-concat selector here; keep the skin-prefix guards, which these
  // files never legitimately hit.
  {
    files: ["src/skins/**/actions.ts", "src/skins/**/intelligence/**"],
    ignores: SKIN_TEST_FILES,
    rules: {
      "no-restricted-syntax": [
        "error",
        literalSkinPrefix,
        templateLeadingPrefix,
      ],
    },
  },
];

export default eslintConfig;
