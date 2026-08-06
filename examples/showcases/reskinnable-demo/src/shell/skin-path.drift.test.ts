import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { skinIds } from "@/shell/skins-config";

/**
 * Drift guard for the URL contract (see `src/shell/skin-path.ts`, `src/proxy.ts`).
 *
 * No file under `src/skins/**` may hardcode a skin's own route prefix in a link.
 * Every in-skin href goes through `useSkinHref`, which drops the prefix on a
 * LOCK_SKIN deploy — where the app is served AT `/`.
 *
 * WHY A STATIC GUARD AND NOT A RENDER TEST. This violation is invisible to every
 * other check we have. A hardcoded `/banking/cards` type-checks, lints, renders,
 * and NAVIGATES CORRECTLY — the route still resolves under a lock, because the
 * proxy rewrite is what serves it. The only symptom is that the tenant segment
 * reappears in the address bar on the first nav click, silently undoing the
 * single-tenant illusion the lock exists to create. Nothing fails; the demo just
 * quietly stops being what it claims to be. So the guard has to be lexical.
 *
 * The one legitimate hardcoded prefix is the shell's skin SWITCHER
 * (`src/shell/layout/selector-card.tsx`), which links to a DIFFERENT skin and
 * only ever renders unlocked. It lives outside `src/skins/`, so it is out of
 * scope here by construction rather than by exemption list.
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

// A quoted absolute path opening with a skin id: "/keel/…", `/banking`, '/airline/x'.
const HARDCODED_ID = new RegExp(
  String.raw`["'\`]/(${skinIds.join("|")})(?:/|["'\`])`,
);
// The interpolated form: `/${skin.id}/…` — same defect, different spelling.
const INTERPOLATED_ID = /["'`]\/\$\{skin(?:Id)?\.?i?d?\}/;

describe("URL contract drift guard", () => {
  const files = sourceFiles(SKINS_DIR);

  it("finds skin sources to check (guards against a broken glob)", () => {
    // Without this, a bad path would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(50);
  });

  it("no skin hardcodes its own route prefix in a link", () => {
    const offenders = files.filter((f) =>
      HARDCODED_ID.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(
      offenders.map((f) => path.relative(SKINS_DIR, f)),
      "Use useSkinHref(skin.id) — a hardcoded prefix reappears in the address " +
        "bar on a LOCK_SKIN deploy. See src/shell/skin-path.ts.",
    ).toEqual([]);
  });

  it("no skin interpolates its own id into a link", () => {
    const offenders = files.filter((f) =>
      INTERPOLATED_ID.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(
      offenders.map((f) => path.relative(SKINS_DIR, f)),
      "Use useSkinHref(skin.id) rather than building `/${skin.id}/…` by hand.",
    ).toEqual([]);
  });

  it("catches a violation when one is introduced (the guard itself works)", () => {
    // A guard that cannot fail is not a guard. These are the exact shapes the
    // four skins used before the cutover.
    expect(HARDCODED_ID.test("href={`/keel/runs/${run.id}`}")).toBe(true);
    expect(HARDCODED_ID.test('href="/keel/knowledge"')).toBe(true);
    expect(HARDCODED_ID.test('router.push("/banking")')).toBe(true);
    expect(INTERPOLATED_ID.test("href={`/${skin.id}/${route.segment}`}")).toBe(
      true,
    );
    // ...and does not fire on the compliant forms.
    expect(HARDCODED_ID.test("href={keelHref(`runs/${run.id}`)}")).toBe(false);
    expect(INTERPOLATED_ID.test("const skinHref = useSkinHref(skin.id);")).toBe(
      false,
    );
    // Nor on a skin's own REST base, which is a server path and unaffected by
    // the lock (logistics/actions.ts has `const BASE = "/api/logistics/v1"`).
    expect(HARDCODED_ID.test('const BASE = "/api/logistics/v1";')).toBe(false);
  });
});
