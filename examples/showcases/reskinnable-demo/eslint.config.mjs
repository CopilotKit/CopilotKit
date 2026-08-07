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
const SKIN_IDS = "banking|airline|logistics|keel|people|vantage";

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

// (ii) A template that appends `/`-path onto an interpolation
// (`` `${base}/charges` ``) — concatenating onto a builder result, which emits a
// protocol-relative `//` under a lock (base is "/" there).
//
// WHY THIS ONE IS USE-SITE SCOPED (the other two are not). The bare shape
// "interpolation, then a quasi opening with `/`" is AST-IDENTICAL to ordinary
// non-URL templates: `` `${month}/${day}` `` (a date), `` `${used}/${total} used` ``
// (a fraction). Nothing in how the string is WRITTEN separates a path from a ratio —
// only what it is FOR. A shape-only selector therefore false-positives on any skin
// component that formats a date or a ratio, blocking it with a link error that makes
// no sense for that code. So this selector fires ONLY when the template is actually a
// NAVIGATION TARGET: passed to `router.push`/`router.replace`, to
// `location.assign(...)`, assigned to `location.href`, or set as a JSX `href={...}`.
// A date/ratio formatter is never in navigation code, so it is untouched; a broken
// link is, so it is still caught.
//
// RESIDUAL LIMITATION (stated plainly — do not read this guard as complete). Ancestry
// scoping only sees the template at the call/attribute site. A URL assembled into a
// variable first and then navigated —
// `const u = `${base}/charges`; router.push(u)` — is NOT caught, because the
// TemplateLiteral is no longer a descendant of the `push(...)` call. That blind spot
// is the price of zero false positives on ordinary interpolation. The literal-prefix
// guards above still catch the common hardcoding shapes regardless of use site.
//
// Because it is nav-scoped, this selector never fires on the REST/data layer's
// `` `${apiBase}/shipments` `` (that concatenation is not a nav target), so the
// per-file scoping below is belt-and-suspenders rather than load-bearing.
// Scoped to navigation OBJECTS as well as METHODS. A bare method-name match
// (`.push`/`.replace`/`.assign` on ANYTHING) over-fires on ordinary skin code:
// `String.prototype.replace("q", `${a}/${b}`)`, `Object.assign(o, {…})`, and
// `Array.prototype.push(`${a}/${b}`)` are all realistic (formatting, tokens,
// ratios) and are NOT navigation. So each call form pins its object:
//   - `router.push(...)` / `router.replace(...)`  — object named `router`
//   - `location.assign(...)`                       — object named `location`
//   - `window.location.assign(...)`                — object is a member expr
//                                                    whose property is `location`
//   - `location.href = ...` / `window.location.href = ...` — AssignmentExpression
//     onto a `.href` member (both bare and `window.`-qualified `location`)
//   - JSX `href={...}`                             — already object-precise
const NAV_TARGET_ANCESTORS = [
  `CallExpression[callee.object.name="router"][callee.property.name="push"]`,
  `CallExpression[callee.object.name="router"][callee.property.name="replace"]`,
  `CallExpression[callee.object.name="location"][callee.property.name="assign"]`,
  `CallExpression[callee.object.property.name="location"][callee.property.name="assign"]`,
  `JSXAttribute[name.name="href"]`,
  `AssignmentExpression[left.property.name="href"]`,
];
const interpolationThenSlash = {
  selector: NAV_TARGET_ANCESTORS.map(
    (ancestor) =>
      `${ancestor} TemplateLiteral > TemplateElement:not(:first-child)[value.raw=/^\\//]`,
  ).join(", "),
  message: `In-skin navigation target concatenates a path onto an interpolated base, yielding a leading "//" under a lock. ${FIX_HINT}`,
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
