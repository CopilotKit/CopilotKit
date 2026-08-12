import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * The LOCK_SKIN URL contract, enforced against the AST — NOT by scanning source
 * as text: a regex over raw source is a re-implementation of a fragment of a JS
 * parser, and drifts out of true. ESLint already has the parser; these are
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
 * appears inside a comment or string of prose. It also cannot be fooled by a `$`
 * in a variable name.
 */

/**
 * Route id segments the selectors below guard.
 *
 * WHY A HAND-COPY OF `skinIds` AND NOT AN IMPORT. The source of truth is
 * `skinIds` in `src/shell/skins-config.ts`, but this file cannot import it: an
 * ESLint flat config is loaded by Node, `skins-config.ts` is TypeScript, and
 * teaching ESLint to load a `.ts` config needs `jiti`, which this app does not
 * depend on. Re-exporting the ids through a plain `.mjs` module instead would
 * cost `skinIds` its `as const` tuple type — which `skinIdentities` relies on to
 * stay exhaustive — so the copy is the cheapest correct option.
 *
 * WHY IT IS EXPORTED. A hand-copied list rots silently — a stale entry lets a
 * hardcoded `"/<skin>/…"` href pass `pnpm lint` cleanly while breaking the
 * address bar on a locked deploy, and nothing fails. The export
 * exists so `src/shell/skins-config.test.ts` can lint a synthetic prefixed link
 * for EVERY registered skin through these very selectors and fail when one is
 * unguarded. ESLint reads only the default export; this named one is inert to it.
 */
export const LINTED_SKIN_IDS = [
  "banking",
  "airline",
  "logistics",
  "keel",
  "people",
  "commerce",
  "bookstore",
];

const SKIN_IDS = LINTED_SKIN_IDS.join("|");

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

/**
 * BEAT 6 INVARIANT — the unlock vocabulary is withheld from the agent.
 *
 * Beat 6's claim is "when it doesn't know, it learns by watching me once". An
 * agent holding the catalogue of codes that lift a gate already knows: it clears
 * the gate unaided and there is nothing left to teach. A catalogue reaches the
 * agent four ways — a `useAgentContext` readable, a `z.enum(ESCALATION_CODES)`
 * on the filing tool's schema, the tool's own description pointing the agent at
 * "the catalogue in your context", and an `agent.ts` prompt line listing "valid
 * escalation codes" among what is "provided".
 *
 * WHAT THIS RULE CAN AND CANNOT SEE. It matches an IDENTIFIER, so it covers the
 * first two only. The other two are PROSE — a tool `description` string and the
 * prompt — and no identifier selector can catch a sentence. They are a
 * HAND-REVIEW item; failure-modes.md § 10 says so out loud and lists the grep.
 * Treat a green lint here as "the catalogue is not referenced", never as "the
 * vocabulary is withheld".
 *
 * WHY A LINT RULE AND NOT A TEST. This is a project invariant, not a behaviour:
 * the app compiles, lints, type-checks and demos perfectly with the readable
 * restored, and the only symptom is that the teach beat quietly stops proving
 * anything. It belongs beside the LOCK_SKIN selectors, which exist for the same
 * reason — a failure with no runtime symptom.
 *
 * WHY AST AND NOT A SOURCE-STRING SCAN. A schema leak is routinely line-WRAPPED
 * (`.enum(ESCALATION_CODES)` on its own line), so a guard for the text
 * "z.enum(ESCALATION_CODES)" silently never matches. This selector matches the
 * IDENTIFIER and is immune to formatting.
 *
 * The `files` glob below is the SKINS ALREADY FIXED — both agent-facing files of
 * each, `tools.tsx` AND `agent.ts`. Widen it as each remaining skin's gate lands;
 * a glob covering an unfixed skin turns the tree red for the whole phase.
 */
const withheldGateVocabulary = {
  selector: "Identifier[name=/_(CODE_LABELS|CODES)$/]",
  message:
    "Beat 6: a gate's unlock vocabulary must never reach the agent, and this file " +
    "is agent-facing. Do not name or import a code catalogue here — no " +
    "useAgentContext readable, no tool-schema z.enum, no server defineTool enum. " +
    "Take a free z.string() and say in its .describe() that the catalogue is " +
    "withheld; the agent learns which code works by WATCHING the operator file " +
    "one. Keep the labels for the human filing form only (import them in the form " +
    "component, not here). This rule cannot see PROSE — a tool description or a " +
    "prompt sentence leaks just as effectively and is a hand-review item. See " +
    ".claude/skills/reskin/failure-modes.md § 10.",
};

/**
 * BEAT 2 INVARIANT — a tool render's terminal branch must come from the RESULT.
 *
 * On replay — a reopened thread, or a hard reload in Intelligence mode — the
 * recorded tool `result` is handed back but the live `status` transitions never
 * fire. A render whose completed branch is chosen by
 * `status === ToolCallStatus.Complete` is therefore perfect for the entire live
 * demo and renders its PENDING copy forever the moment the thread is reopened —
 * which is precisely the reload beat 2 exists to perform on stage.
 *
 * WHY A LINT RULE. The defect is structural, not behavioural: it is about which
 * value selects the branch, and it has no live symptom at all. Nothing else in
 * the tree catches it.
 *
 * The `files` glob is the SKINS ALREADY RE-KEYED — widen it per phase. Note the
 * `status === ToolCallStatus.Executing` guard on an INTERACTIVE branch is correct
 * and deliberately not matched: an executing HITL card only ever exists live.
 */
const statusKeyedTerminalRender = {
  selector:
    "BinaryExpression[operator='==='][left.name='status'][right.object.name='ToolCallStatus'][right.property.name='Complete']",
  message:
    "Beat 2: choose a tool render's terminal branch from the recorded `result`, " +
    "not from `status`. On replay the result comes back but no status transition " +
    "fires, so this renders the pending copy forever on a reopened thread. " +
    "(`status === ToolCallStatus.Executing` on the interactive branch is fine.)",
};

/**
 * The selectors above, KEYED BY NAME — the seam `src/shell/skins-config.test.ts`
 * uses to assert the RESOLVED selector list of a real file.
 *
 * WHY A NAME MAP AND NOT A `name` FIELD ON EACH SELECTOR. `no-restricted-syntax`
 * validates its options against a schema with `additionalProperties: false` and
 * exactly `{ selector, message }`, so an extra `name` key is a hard config error
 * ("Unexpected property \"name\""). The stable identity therefore has to live
 * OUTSIDE the option object; the test reverses this map on the `selector` string.
 *
 * WHY IT EXISTS AT ALL. Flat-config `rules` options are REPLACED, not merged — a
 * later matching block silently drops every selector it does not restate, and
 * that drop is invisible to `pnpm lint`, to the whole unit suite, and to this
 * config's own synthetic-link test. ESLint reads only the default export; this
 * named one is inert to it.
 */
export const NAMED_SELECTORS = {
  literalSkinPrefix,
  templateLeadingPrefix,
  interpolationThenSlash,
  withheldGateVocabulary,
  statusKeyedTerminalRender,
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
  // BEAT 2 — see statusKeyedTerminalRender. Scoped to the skins already re-keyed.
  // Every skin named here was verified clean BEFORE its glob entry was added:
  // every remaining `ToolCallStatus` reference in it is either a comment or a
  // `=== ToolCallStatus.Executing && respond` HITL branch (the interactive
  // affordance drawn while a response is awaited), never a `.Complete` terminal
  // render — which is the shape this selector exists to catch. Widen this glob
  // only after checking the same, because a glob covering an unfixed skin turns
  // the tree red for a whole phase, and a phase that cannot end green is a phase
  // nobody can bisect.
  //
  // ⚠️ RESTATES THE LOCK_SKIN SELECTORS, and must keep doing so — flat-config
  // `rules` are REPLACED, not merged (see NAMED_SELECTORS). This block must also
  // stay ABOVE the beat-6 block below: that one is narrower by FILE but ESLint
  // resolves by ORDER, not specificity, so a skin-wide block placed after it
  // would silently strip `withheldGateVocabulary` from `tools.tsx`/`agent.ts`.
  {
    files: [
      "src/skins/logistics/**/*.tsx",
      "src/skins/airline/**/*.tsx",
      "src/skins/keel/**/*.tsx",
    ],
    ignores: SKIN_TEST_FILES,
    rules: {
      "no-restricted-syntax": [
        "error",
        literalSkinPrefix,
        templateLeadingPrefix,
        interpolationThenSlash,
        statusKeyedTerminalRender,
      ],
    },
  },
  // BEAT 6 — see withheldGateVocabulary. Scoped to the two AGENT-FACING files of
  // each skin whose gate has landed: `tools.tsx` (a readable or a client
  // tool-schema enum) and `agent.ts` (the prompt, and a server `defineTool` enum).
  // The human filing FORM legitimately imports the labels, so it is not covered.
  //
  // ⚠️ THIS BLOCK MUST RESTATE THE LOCK_SKIN SELECTORS, and every future widening
  // of it must too. Flat-config `rules` are REPLACED, not merged: this block is the
  // last one matching these files, so listing only `withheldGateVocabulary` here
  // silently DISABLES the three URL-contract selectors from the `src/skins/**`
  // block above for exactly these files. That is invisible — `logistics/tools.tsx`
  // has no nav shape today, so nothing fails; a hardcoded `/logistics/...` href
  // added to it later would just pass.
  //
  // A passing `pnpm lint` proves nothing here, and neither does a COUNT — a count
  // rots the moment a block changes, and different files legitimately resolve to
  // different totals (`actions.ts` resolves to two).
  // The mechanical check is `src/shell/skins-config.test.ts` § "the resolved
  // no-restricted-syntax selectors", which asserts the resolved selector LIST,
  // by name, per file, through `ESLint#calculateConfigForFile`. Add every file
  // whose selector set you change to its table.
  {
    // Three skins ship a withheld gate vocabulary: logistics (escalation codes),
    // airline (fare-waiver categories) and keel (publication-variance codes).
    // Each contributes exactly its two AGENT-FACING files. The human filing FORMS
    // — logistics' escalation-form, airline's fare-exception-form, keel's
    // variance-form — legitimately import the labels and are deliberately NOT
    // listed: a withheld catalogue with no form is an unlearnable gate.
    files: [
      "src/skins/logistics/tools.tsx",
      "src/skins/logistics/agent.ts",
      "src/skins/airline/tools.tsx",
      "src/skins/airline/agent.ts",
      "src/skins/keel/tools.tsx",
      "src/skins/keel/agent.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        literalSkinPrefix,
        templateLeadingPrefix,
        interpolationThenSlash,
        withheldGateVocabulary,
        statusKeyedTerminalRender,
      ],
    },
  },
];

export default eslintConfig;
