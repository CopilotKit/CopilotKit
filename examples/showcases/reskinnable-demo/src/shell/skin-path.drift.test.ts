import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { skinIds } from "@/shell/skins-config";

/**
 * Drift guard for the URL contract (see `src/shell/skin-path.ts`, `src/proxy.ts`).
 *
 * THE INVARIANT (not a spelling list). Under a LOCK_SKIN deploy the app is served
 * AT `/`, so no in-skin link may carry a skin prefix or produce a `//`. Every
 * in-skin href must go through `useSkinHref` / `useKeelHref`, which drop the
 * prefix (returning `/`) on a lock. This guard fails if any `src/skins/**` source
 * builds a link that violates that invariant, in ANY of the three shapes we have
 * seen it take:
 *
 *   (iii) a LITERAL skin prefix         — `"/banking/cards"`, `` `/keel/runs` ``
 *   (i)   an INTERPOLATED id at the start— `` `/${skin.id}/…` ``, `` `/${id}/…` ``
 *   (ii)  CONCATENATION onto a builder  — `` `${base}/x` ``, `` `${base}${x}` ``
 *         result, where `base = skinHref()`
 *
 * An earlier version of this guard enumerated the exact spellings `${skin.id}` /
 * `${skinId}` and the literal ids. For shapes (iii) and (i) that was a losing
 * game: it reported green while blind to a renamed id holder like `` `/${s.id}/…` ``.
 * So those two detectors now match the SHAPE — ANY registered id, and ANY
 * expression whose tail is `id`/`Id` — rather than a fixed spelling list.
 *
 * Detector (ii) is HONESTLY DIFFERENT, and the difference is a deliberate design
 * choice, not the same mistake one level up. It is NAME-GATED: it fires only on a
 * variable bound from a bare `skinHref(` / `keelHref(` call — the two sanctioned
 * builder-result names. This is forced, not lazy. A purely lexical guard cannot
 * tell a skin-href call from any other string-returning call: `const base =
 * skinHref()` and `const base = apiUrl.replace(...)` (banking/intelligence) are
 * the SAME shape, and concatenating onto the latter is legitimate — `` `${base}/api/memories` ``
 * is a server route the lock never touches. "Returns a skin href" is knowable
 * ONLY by name here, so a name gate is the only sound way to catch the
 * `` `${base}/charges` `` bug (the one that shipped a `//`) without falsely tripping
 * every REST base in the tree.
 *
 * THE ACCEPTED BLIND SPOT. Bind the href from a builder under any OTHER name —
 * `const base = linkTo()`, or a method call `const base = api.skinHref()` — and
 * the `//` it would produce slips through silently. That gap is bounded and cheap
 * to accept because `useSkinHref` / `useKeelHref` (whose results these two names
 * hold) are the ONLY in-skin href builders the reskin skill teaches; a conforming
 * skin has no other. The gap is pinned in an executable test below ("documents the
 * one accepted blind spot") so it stays a known, reviewed decision — if a future
 * change makes it fire, that is a scope change to weigh, not a free win.
 *
 * WHY A STATIC GUARD AND NOT A RENDER TEST. This violation is invisible to every
 * other check we have. A hardcoded `/banking/cards` type-checks, lints, renders,
 * and NAVIGATES CORRECTLY — the route still resolves under a lock, because the
 * proxy rewrite is what serves it. The only symptom is the tenant segment (or a
 * `//`) reappearing in the address bar on the first nav click, silently undoing
 * the single-tenant illusion the lock exists to create. Nothing fails; the demo
 * just quietly stops being what it claims to be. So the guard has to be lexical.
 *
 * SCOPE = ANY skin id, not just the file's own. The rule enforced here is
 * STRICTER than "a skin must not hardcode its OWN prefix": no skin source may
 * hardcode ANY skin's prefix. That is deliberate, not an oversight. The one
 * legitimate cross-skin link is the shell's skin SWITCHER
 * (`src/shell/layout/selector-card.tsx`), which lives OUTSIDE `src/skins/` and
 * only ever renders unlocked — so it is out of scope by construction. Inside a
 * skin there is no legitimate reason to hardcode a sibling skin's prefix: under a
 * lock that link is just as broken as hardcoding your own, and unlocked it is the
 * switcher's job. Detecting any id keeps the check simple and closes that hole.
 */
const SKINS_DIR = path.resolve(__dirname, "../skins");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(full)) return [];
    // Tests legitimately assert on prefixed hrefs (they render bare, with no
    // LockedSkinProvider, so unlocked output is the correct expectation).
    if (/\.test\.tsx?$/.test(full)) return [];
    return [full];
  });
}

/** Strip comments so prose explaining `/keel/knowledge/...` is not a violation. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// (iii) A quoted absolute path opening with a skin id: "/keel/…", `/banking`,
// '/airline/x'. Matches ANY registered id, per the SCOPE note above.
const HARDCODED_ID = new RegExp(
  String.raw`["'\`]/(${skinIds.join("|")})(?:/|["'\`])`,
);

// (i) An interpolation at the START of a quoted path whose expression plausibly
// holds a skin id — i.e. the expression ENDS in `id`/`Id` (`id`, `skinId`,
// `skin.id`, `s.id`, `activeSkin.id`). NOT restricted to the literal names
// `skin.id`/`skinId`: a renamed holder is the same defect. Requiring the "id"
// tail keeps `` `/${route.segment}` `` and REST paths like `"/api/x"` clear.
const INTERPOLATED_ID_START =
  /["'`]\/\$\{\s*(?:[A-Za-z_$][\w$]*\.)?[A-Za-z_$]*[iI][dD]\s*\}/;

// (ii) A variable bound to the RESULT of a skin href builder — `const base =
// skinHref()`, `const href = keelHref(seg)`. The builder returns a COMPLETE href
// (just `/` under a lock), so appending a path onto it is what yields `//`.
// Gating on this binding is what separates the real defect from the legitimate
// REST bases `const base = apiUrl.replace(...)` (banking/intelligence) and
// `const BASE = "/api/logistics/v1"` (logistics/actions) — neither is a builder
// result, so neither is captured. `useSkinHref`/`useKeelHref` (the builder
// FACTORY, not its result) are excluded: the RHS must be a bare `skinHref(`.
const HREF_BUILDER_BINDING =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:skinHref|keelHref)\s*\(/g;

/**
 * Returns the name of a builder-bound variable that gets a path concatenated onto
 * it (`` `${name}/…` `` or `` `${name}${…}` ``), or null. The trailing `${…}` case
 * catches `` `${base}${page}` `` where `page` carries its own leading slash — a
 * `//` that is invisible line-by-line. A `${name}` followed by `?` (query) or `#`
 * (hash) is fine and not matched, which is why keel's deep links
 * (`` `${keelHref(...)}#${id}` ``) — inline calls, not bound vars — stay green.
 */
function builderResultConcat(src: string): string | null {
  const names = [...src.matchAll(HREF_BUILDER_BINDING)].map((m) => m[1]);
  for (const name of names) {
    const rx = new RegExp(String.raw`\$\{\s*${name}\s*\}(?:/|\$\{)`);
    if (rx.test(src)) return name;
  }
  return null;
}

/** All three detectors as one invariant. Returns a reason string, or null. */
function urlContractOffense(src: string): string | null {
  const clean = stripComments(src);
  if (HARDCODED_ID.test(clean)) return "hardcodes a skin route prefix";
  if (INTERPOLATED_ID_START.test(clean))
    return "interpolates a skin id at the start of a link path";
  const v = builderResultConcat(clean);
  if (v)
    return `concatenates a path onto the skinHref()/keelHref() result \`${v}\``;
  return null;
}

describe("URL contract drift guard", () => {
  const files = sourceFiles(SKINS_DIR);

  it("finds skin sources to check (guards against a broken glob)", () => {
    // Without this, a bad path would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(50);
  });

  it("no skin source builds an in-skin link that breaks the lock", () => {
    const offenders = files
      .map((f) => ({
        file: path.relative(SKINS_DIR, f),
        reason: urlContractOffense(readFileSync(f, "utf8")),
      }))
      .filter((o) => o.reason)
      .map((o) => `${o.file} — ${o.reason}`);
    expect(
      offenders,
      "Under a LOCK_SKIN deploy the app is served at `/`. Build every in-skin " +
        "link through useSkinHref(skin.id) / useKeelHref() — a hardcoded or " +
        "hand-concatenated prefix puts the tenant segment (or a `//`) back in " +
        "the address bar on the first nav. See src/shell/skin-path.ts.",
    ).toEqual([]);
  });

  it("the guard itself fires — catches every known violation shape", () => {
    // A guard that cannot fail is not a guard. These are the shapes the four
    // skins used (or nearly shipped) before/through the cutover — including the
    // exact forms the previous spelling-list guard was BLIND to.

    // (iii) literal skin prefix — any id, any quote.
    expect(urlContractOffense("href={`/keel/runs/${run.id}`}")).toBeTruthy();
    expect(urlContractOffense('href="/keel/knowledge"')).toBeTruthy();
    expect(urlContractOffense('router.push("/banking")')).toBeTruthy();

    // (i) interpolated id at the start — the literal spelling AND every renamed
    // holder the old regex missed.
    expect(
      urlContractOffense("href={`/${skin.id}/${route.segment}`}"),
    ).toBeTruthy(); // the one shape the old guard caught
    expect(
      urlContractOffense("href={`/${s.id}/${route.segment}`}"),
    ).toBeTruthy(); // MISSED before: renamed variable
    expect(urlContractOffense("href={`/${id}/cards`}")).toBeTruthy(); // MISSED before: bare id
    expect(urlContractOffense("href={`/${activeSkin.id}/cards`}")).toBeTruthy(); // MISSED before: other holder
    expect(urlContractOffense("href={`/${skinId}/x`}")).toBeTruthy(); // skinId spelling

    // (ii) concatenation onto a builder result — THE BUG THAT ACTUALLY SHIPPED,
    // plus the slashless `${base}${page}` twin. Both need the binding in view.
    expect(
      urlContractOffense(
        "const base = skinHref();\nrouter.push(`${base}/charges`);",
      ),
    ).toBeTruthy(); // MISSED before: `${base}/x`, base = skinHref()
    expect(
      urlContractOffense(
        "const base = skinHref();\nconst t = `${base}${page.toLowerCase()}`;",
      ),
    ).toBeTruthy(); // MISSED before: `${base}${x}`
    expect(
      urlContractOffense(
        "const kh = keelHref();\nrouter.push(`${kh}/runs/${id}`);",
      ),
    ).toBeTruthy(); // renamed builder var
  });

  it("the guard spares the legitimate forms (no false positives)", () => {
    // Compliant in-skin links: routed through the builder, never concatenated.
    expect(urlContractOffense("href={keelHref(`runs/${run.id}`)}")).toBeNull();
    expect(
      urlContractOffense("const skinHref = useSkinHref(skin.id);"),
    ).toBeNull();
    // The builder FACTORY binding is not a builder RESULT — must not be captured.
    expect(
      urlContractOffense(
        "const skinHref = useSkinHref(skin.id);\nconst x = `${skinHref('cards')}`;",
      ),
    ).toBeNull();
    // A builder result bound and used bare, or with a query/hash suffix — fine.
    expect(
      urlContractOffense(
        "const href = skinHref(route.segment);\nreturn <a href={href} />;",
      ),
    ).toBeNull();
    expect(
      urlContractOffense(
        "const c = skinHref('charges');\nrouter.push(`${c}?${qs}`);",
      ),
    ).toBeNull();
    // keel deep links: inline builder call + hash suffix — the established
    // pattern, never a bound-var path concat.
    expect(
      urlContractOffense(
        "href={`${keelHref(`knowledge/${docId}`)}#${sectionId}`}",
      ),
    ).toBeNull();
    expect(
      urlContractOffense(
        "const h = `${keelHref(`knowledge/${docId}`)}${sectionId ? `#${sectionId}` : ''}`;",
      ),
    ).toBeNull();

    // The two REST bases the invariant must NOT touch: they are server paths,
    // unaffected by the lock, and their `base`/`BASE` is not a builder result.
    expect(
      urlContractOffense(
        'const base = apiUrl.replace(/\\/$/, "");\nawait fetch(`${base}/api/memories`);',
      ),
    ).toBeNull(); // banking/intelligence
    expect(
      urlContractOffense(
        'const BASE = "/api/logistics/v1";\nawait fetch(`${BASE}/shipments`);',
      ),
    ).toBeNull(); // logistics/actions
    // A skin id appearing mid-path in a REST route is not a prefix.
    expect(
      urlContractOffense("fetch(`/api/banking/v1/cards/${cardId}/policy`)"),
    ).toBeNull();
  });

  it("documents the one accepted blind spot: a renamed href builder", () => {
    // Detector (ii) is name-gated to the two sanctioned builder-result names
    // `skinHref`/`keelHref` (see the header). Bind the href from a builder under
    // ANY other name and the `//` it would produce is NOT caught. These asserts
    // pin that deliberate precision/recall trade-off in executable form: the gap
    // is a reviewed decision, not a silent regression. If a future change makes
    // either of these fire, that is a scope change to weigh — treat this test as
    // the checkpoint, not an incidental red.
    expect(
      urlContractOffense(
        "const base = linkTo();\nrouter.push(`${base}/charges`);",
      ),
    ).toBeNull(); // renamed BUILDER (not skinHref/keelHref) — accepted blind spot
    expect(
      urlContractOffense(
        "const base = api.skinHref();\nrouter.push(`${base}/charges`);",
      ),
    ).toBeNull(); // method-call builder — RHS is not a bare `skinHref(`
  });
});
