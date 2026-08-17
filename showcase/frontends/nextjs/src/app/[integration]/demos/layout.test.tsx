import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The regression this file exists for: the support guard used to live in
 * the dynamic `[demo]/page.tsx`, which stopped being reached once all 43
 * demos landed as STATIC segments. Unit tests kept passing because they
 * called the placeholder directly. These tests call the LAYOUT — the node
 * that actually wraps a static demo segment — and assert that the child
 * page is not rendered when the pair is unsupported.
 */
const store = vi.hoisted(() => ({
  pathname: null as string | null,
  /**
   * When true, `headers()` returns a stub whose `get` yields the stored value
   * VERBATIM instead of a real `Headers`. Needed because the Fetch spec
   * normalizes header values on construction, so a real
   * `new Headers({ "x-pathname": "   " }).get(...)` is already `""` and the
   * layout's whitespace branch can never be reached through it.
   */
  raw: false,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    // Imported here rather than at module scope: `vi.mock` factories are
    // hoisted above the imports, so the constant has to be pulled in lazily.
    const { PATHNAME_HEADER } = await import("@/middleware");
    if (store.pathname === null) return new Headers({});
    if (store.raw) {
      return {
        get: (name: string) =>
          name === PATHNAME_HEADER ? store.pathname : null,
      };
    }
    return new Headers({ [PATHNAME_HEADER]: store.pathname });
  },
}));

import {
  listAllDemoIds,
  listIntegrations,
  resolveDemoSupport,
} from "@/lib/integration-support";
import {
  effectivePathnameHeader,
  middlewareRuns,
} from "@/lib/test-helpers/middleware-matcher";
import {
  stripComments,
  stripCommentsWithMode,
} from "@/lib/test-helpers/strip-comments";
import { PATHNAME_HEADER } from "@/middleware";

import DemosLayout from "./layout";

const CHILD_MARKER = "REAL_DEMO_PAGE_RENDERED";

async function render(slug: string, pathname: string | null): Promise<string> {
  store.pathname = pathname;
  const element = await DemosLayout({
    children: <div>{CHILD_MARKER}</div>,
    params: Promise.resolve({ integration: slug }),
  });
  return renderToStaticMarkup(element);
}

/** Render with a header source that does NOT normalize the value. */
async function renderRaw(slug: string, pathname: string): Promise<string> {
  store.raw = true;
  try {
    return await render(slug, pathname);
  } finally {
    store.raw = false;
  }
}

beforeEach(() => {
  store.pathname = null;
  store.raw = false;
});

describe("demos layout guard", () => {
  it("renders the child page for a supported pair", async () => {
    const html = await render(
      "langgraph-python",
      "/langgraph-python/demos/agentic-chat",
    );
    expect(html).toContain(CHILD_MARKER);
  });

  it("renders the child page for a supported pair the shell links with a trailing slash", async () => {
    const html = await render(
      "langgraph-python",
      "/langgraph-python/demos/agentic-chat/",
    );
    expect(html).toContain(CHILD_MARKER);
  });

  it("blocks a demo the integration declares not supported", async () => {
    // spring-ai lists gen-ui-interrupt under `not_supported_features` while
    // still shipping the demo folder — the exact pair that regressed.
    const html = await render("spring-ai", "/spring-ai/demos/gen-ui-interrupt");
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Not supported");
    expect(html).toContain('role="alert"');
  });

  it("blocks a union pair the integration never declares", async () => {
    const html = await render("agno", "/agno/demos/a2ui-recovery");
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Not supported");
  });

  it("blocks an unknown integration even when the demo segment exists", async () => {
    const html = await render("nope", "/nope/demos/agentic-chat");
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Invalid Showcase route");
  });

  it(`fails loud when middleware did not set ${PATHNAME_HEADER}`, async () => {
    const html = await render("langgraph-python", null);
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Invalid Showcase route");
    expect(html).toContain(PATHNAME_HEADER);
  });

  it(`fails loud when ${PATHNAME_HEADER} is present but empty`, async () => {
    // An empty string is not `null`. Before this, it fell straight through
    // to `children` with the guard skipped — the opposite of fail-loud.
    const html = await render("langgraph-python", "");
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Invalid Showcase route");
  });

  it(`fails loud when ${PATHNAME_HEADER} holds only whitespace`, async () => {
    // Driven through a RAW header source on purpose. A real `Headers`
    // normalizes the value (see the spec test below), so `"   "` arrives as
    // `""` and would only re-run the empty-string case above — the layout's
    // `pathname.trim() === ""` branch would never be reached and this test
    // would assert coverage it does not provide. Any header source that does
    // not normalize (a shim, a test double, a future middleware that passes
    // the pathname by another route) must still be rejected.
    const html = await renderRaw("langgraph-python", "   ");
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Invalid Showcase route");
  });

  it("pins the Headers normalization the whitespace case exists for", async () => {
    // The reason the case above needs a raw stub: per the Fetch spec, header
    // values are stripped of leading/trailing whitespace when the `Headers`
    // object is built. If this ever stops holding, the raw stub is no longer
    // needed and `render` alone would exercise the branch.
    expect(new Headers({ [PATHNAME_HEADER]: "   " }).get(PATHNAME_HEADER)).toBe(
      "",
    );
  });

  it("passes through the demos index", async () => {
    const html = await render("langgraph-python", "/langgraph-python/demos");
    expect(html).toContain(CHILD_MARKER);
  });

  it("blocks a demo path deeper than /<slug>/demos/<demo>", async () => {
    const html = await render(
      "langgraph-python",
      "/langgraph-python/demos/agentic-chat/extra",
    );
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Invalid Showcase route");
  });

  it("blocks a path shifted by a Next.js basePath", async () => {
    // The extra leading segment used to push every demo path out of the
    // 3-segment shape, silently disabling the guard for EVERY demo through
    // configuration alone.
    const html = await render(
      "langgraph-python",
      "/base/langgraph-python/demos/agentic-chat",
    );
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Invalid Showcase route");
  });

  it("blocks a spoofed x-pathname that names a different integration", async () => {
    // The layout's own defence, tested WITHOUT the middleware in front of it:
    // a header naming a slug the layout was not rendered for must not skip
    // the guard, whatever let that header through. The matcher no longer
    // skips demo routes (see the end-to-end test below), so this is now
    // defence in depth rather than the answer to a live gap — but it is the
    // only thing the layout can check for itself, so it stays pinned.
    const html = await render(
      "spring-ai",
      "/langgraph-python/demos/agentic-chat",
    );
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Invalid Showcase route");
  });

  it("blocks a spoofed x-pathname on a dotted demo path, middleware included", async () => {
    /**
     * THE FULL CHAIN, not the layout alone. Every other test in this file
     * hands the layout a header directly, which cannot see the one thing that
     * decides whether the header is trustworthy: the middleware matcher.
     *
     * The attack the matcher used to allow. `/mastra/demos/gen-ui-interrupt.x`
     * contains a dot, the matcher's static-asset exclusion skipped ANY path
     * with a dot, so the middleware did not run and `x-pathname` arrived
     * exactly as the client wrote it. `classifyDemoPathname` compares only
     * SEGMENT 0 of the header against the `[integration]` param, so a header
     * naming the same slug but a DIFFERENT, supported demo passed the guard
     * and the layout rendered `children` for a request whose real demo id was
     * `gen-ui-interrupt.x`.
     *
     * `[demo]/page.tsx` still answered `malformed` (it reads the real id from
     * `params`), so nothing bad shipped — but the layout guard was skipped,
     * and it is the node that wraps the 43 STATIC demo segments too.
     */
    const realUrl = "http://localhost:3000/mastra/demos/gen-ui-interrupt.x";
    const spoofed = "/mastra/demos/agentic-chat";

    // mastra really does support the demo the spoof names — otherwise the
    // header would be rejected for a reason that has nothing to do with the
    // matcher and this test would prove nothing.
    expect(resolveDemoSupport("mastra", "agentic-chat").kind).toBe("supported");

    expect(middlewareRuns("/mastra/demos/gen-ui-interrupt.x")).toBe(true);

    const header = effectivePathnameHeader(realUrl, spoofed);
    expect(header).toBe("/mastra/demos/gen-ui-interrupt.x");

    const html = await render("mastra", header);
    expect(html).not.toContain(CHILD_MARKER);
    expect(html).toContain("Invalid Showcase route");
  });

  it("declares every demo folder on disk in some manifest", async () => {
    // Derived from disk on both sides — a folder added without a manifest
    // entry fails here instead of quietly falling out of a magic floor.
    const known = new Set(listAllDemoIds());
    expect(demoFolderIds().filter((id) => !known.has(id))).toEqual([]);
  });

  it("guards every (integration, demo folder) pair on disk", async () => {
    /**
     * WHAT THIS REPLACED, AND WHY. The previous version of this test looped
     * over every demo folder but rendered `render("nope", …)` on EVERY
     * iteration — the slug was hardcoded. `resolveDemoSupport` answers
     * `malformed` on the unknown-integration branch before it ever looks at
     * the demo id, so the loop body's outcome did not depend on `demoId` at
     * all: it asserted "an unknown integration is blocked" ~43 times and
     * checked not one real (slug, demo) pair. The regression this whole file
     * exists for — a STATIC demo folder rendering while the pair is
     * unsupported — was therefore not covered per-folder by the test named
     * for covering it. The single unknown-integration case still has its own
     * test above; it does not need a loop.
     *
     * The real cross product is what covers it: every integration slug on
     * disk against every demo folder on disk, asserting that the child page
     * renders EXACTLY when `resolveDemoSupport` says `supported`. Both
     * directions matter — a guard that blocks everything would pass a
     * "not rendered" assertion, and a guard that blocks nothing would pass a
     * "rendered" one.
     */
    const demoIds = demoFolderIds();
    const slugs = listIntegrations().map((manifest) => manifest.slug);
    expect(demoIds.length).toBeGreaterThan(0);
    expect(slugs.length).toBeGreaterThan(0);

    let rendered = 0;
    let blocked = 0;
    const coveredDemos = new Set<string>();
    for (const slug of slugs) {
      for (const demoId of demoIds) {
        // The expectation is derived, not hardcoded per pair: the manifests
        // are the authority on support and this test's job is to prove the
        // LAYOUT agrees with them, for every pair, not to restate them.
        const expected = resolveDemoSupport(slug, demoId).kind === "supported";
        const html = await render(slug, `/${slug}/demos/${demoId}`);
        expect(
          html.includes(CHILD_MARKER),
          `${slug}/${demoId}: resolveDemoSupport says ` +
            `${resolveDemoSupport(slug, demoId).kind}, so the child page ` +
            `must ${expected ? "render" : "NOT render"}`,
        ).toBe(expected);
        coveredDemos.add(demoId);
        if (expected) rendered += 1;
        else blocked += 1;
      }
    }

    // NOTHING WAS CAPPED. Measured at ~1s for the full cross product on a
    // laptop, so there is no truncation to declare. If this ever has to be
    // capped, say so HERE and keep every demo folder covered against at least
    // one supporting slug and one non-supporting slug — a silent `.slice()`
    // is how this test became vacuous the first time.
    expect(rendered + blocked).toBe(slugs.length * demoIds.length);
    expect([...coveredDemos].sort()).toEqual([...demoIds].sort());

    // Both outcomes have to actually occur, or the loop proves nothing about
    // the guard: an all-blocked or all-rendered app would still pass every
    // assertion above.
    expect(rendered).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
  });
});

/**
 * The soft-navigation hole, defended by a test instead of a comment.
 *
 * On a client-side soft navigation Next reuses this layout segment and the
 * guard does not re-run. That is safe only while every navigation to a demo
 * is a full document load. One `<Link href="/spring-ai/demos/...">` anywhere
 * reopens the 200-renders-an-unsupported-demo regression, and nothing else
 * in the suite would notice.
 *
 * WHAT THESE TESTS ACTUALLY CHECK — they are a source-text scan over the
 * `.ts`/`.tsx` files under `src/`, not a resolved module graph. So they
 * cannot see inside `node_modules`, and they cannot evaluate an href. Three
 * ways an earlier single-regex version could be walked past, each now closed
 * by construction rather than by a wider pattern:
 *
 *   1. It only looked at files containing the literal `next/link`, so a
 *      re-exported `Link` wrapper was invisible. Test 1 instead forbids the
 *      `next/link` IMPORT anywhere under `src/` — the wrapper's own module
 *      would have to import it, so there is no file for the client-side
 *      `Link` to come from.
 *   2. It required a literal `demos/` inside the tag, so
 *      `<Link href={buildDemoUrl(slug, id)}>` passed. Test 2 now rejects ANY
 *      element whose tag name ends in `Link`, attributes unread — a scan
 *      cannot prove a computed href is not a demo URL, and a later revision
 *      that DID read attributes had its own hole: `[^>]*` stops at the first
 *      `>`, so `<Link onClick={() => go()} href={url}>` matched only up to
 *      the arrow and contained neither `demos/` nor `href={`.
 *   3. Its comment stripper blanked `//` even inside a template literal,
 *      truncating the line and hiding a match. `stripComments`
 *      (src/lib/test-helpers/strip-comments.ts) is a character-wise pass that
 *      leaves string bodies intact.
 *
 * Both scans FAIL OPEN, so each has a self-check that keeps it honest:
 * `navigationOffenders` is run against planted offenders, and the comment
 * stripper is asserted to finish every scanned file in `code` mode.
 *
 * If a legitimate non-demo `next/link` is ever needed, do not widen these
 * tests: move the support check into the demo pages first, as
 * `layout.tsx` says.
 */
describe("no soft navigation to a demo route", () => {
  it("has no next/link import anywhere in src", () => {
    // The strongest claim a source scan can make, and the one that survives
    // a re-exported wrapper: this app navigates with plain `<a href>` and
    // iframe `src`, both full document loads.
    const offenders = sourceFiles().filter((file) =>
      /\bfrom\s*["']next\/link["']|\brequire\(\s*["']next\/link["']/.test(
        stripComments(readFileSync(file, "utf8")),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("has no Link element or router navigation that could reach a demo route", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      // Comments are prose, not navigation — this very file's doc comment
      // spells out the `<Link href="/spring-ai/demos/...">` it forbids.
      for (const offender of navigationOffenders(
        stripComments(readFileSync(file, "utf8")),
      )) {
        offenders.push(`${file}: ${offender}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * The scanner scanning itself.
   *
   * `navigationOffenders` fails OPEN: a shape it does not match is silently
   * clean, so a hole in it reads exactly like a clean tree. The scan above can
   * therefore never tell you it stopped working. These fixtures do — each is a
   * shape that MUST be flagged, including the one that walked past the
   * previous version.
   */
  it.each([
    // THE HOLE THIS CLOSED. The old regex was `/<(Tag)\b[^>]*>/`, which stops
    // at the first `>` — here the `>` of the arrow function. The "tag" it
    // captured was `<Link onClick={() =`, which contains neither `demos/` nor
    // `href={`, so an arrow handler before the href made ANY Link invisible.
    "<Link onClick={() => go()} href={url}>x</Link>",
    "<Link href={buildDemoUrl(slug, id)}>x</Link>",
    '<Link href="/spring-ai/demos/gen-ui-interrupt">x</Link>',
    '<NavLink href="/x">x</NavLink>',
    "<ui.Link href={u} />",
    '<DemoLink to="/x" />',
    'router.push("/spring-ai/demos/agentic-chat")',
    "router.replace(demoUrl)",
    'history.push("/spring-ai/demos/agentic-chat")',
  ])("flags the planted offender %s", (planted) => {
    expect(navigationOffenders(planted)).not.toEqual([]);
  });

  it.each([
    // Lowercase `<link>` is the HTML element and never navigates.
    '<link rel="stylesheet" href="/x.css" />',
    '<a href="/spring-ai/demos/agentic-chat">x</a>',
    '<iframe title="Agentic Chat" src="/spring-ai/demos/agentic-chat" />',
    "<Linkage href={u} />",
    "items.push(demoId)",
  ])("does not flag the benign %s", (benign) => {
    expect(navigationOffenders(benign)).toEqual([]);
  });

  it("strips every scanned file WITHOUT the comment scanner getting lost", () => {
    // `stripComments` is not a JS lexer: a regex literal holding a quote
    // (`/["']/`) flips it into string mode and it swallows source up to the
    // next matching quote — which in THIS file's case could swallow a real
    // `next/link` import and take the guard above with it. Latent today (every
    // file under src/ currently ends in `code`), silent if it ever stops being
    // latent. This makes it loud. See src/lib/test-helpers/strip-comments.ts.
    const lost = sourceFiles().filter(
      (file) =>
        stripCommentsWithMode(readFileSync(file, "utf8")).endMode !== "code",
    );
    expect(lost).toEqual([]);
  });
});

/**
 * Every soft-navigation shape a source-text scan can flag, in one function so
 * the scan over `src/` and the self-check fixtures above run the SAME code.
 *
 * The element rule is deliberately blunt: ANY element whose tag name ends in
 * `Link` is an offender, with no attempt to read its attributes. Test 1 already
 * forbids the `next/link` import outright, so a `*Link` component under `src/`
 * has nowhere legitimate to come from — and attribute parsing is precisely what
 * broke before, because `[^>]*` cannot survive a `=>` inside a prop.
 */
function navigationOffenders(source: string): string[] {
  const offenders: string[] = [];

  // Tag NAME only — no attribute parsing, so nothing inside the tag can end
  // the match early. Capital `L` on purpose: `<Link>`/`<NavLink>`/`<ui.Link>`
  // are components, while lowercase `<link rel="stylesheet">` is the HTML
  // element and never navigates.
  for (const [, tagName] of source.matchAll(/<([A-Za-z_$][\w$.]*)/g)) {
    if (tagName.endsWith("Link")) offenders.push(`<${tagName} …>`);
  }

  // `router.push`/`router.replace`/`router.prefetch` are soft navigations too.
  // Flag both a literal demo URL and any computed argument that mentions a
  // demo.
  for (const [call] of source.matchAll(
    /\b[\w$.]*router[\w$.]*\.(?:push|replace|prefetch)\([\s\S]{0,200}?\)/gi,
  )) {
    if (/demo/i.test(call)) offenders.push(call);
  }

  // Kept from the original scan: a literal demo URL pushed onto anything that
  // is not named like a router (a history object, a custom nav helper).
  for (const [call] of source.matchAll(
    /\.(?:push|replace)\(\s*[`"'][^`"']*demos\/[^`"']*[`"']/g,
  )) {
    offenders.push(call);
  }

  return offenders;
}

function srcRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

function demoFolderIds(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return readdirSync(here, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .filter((name) => name !== "[demo]");
}

function sourceFiles(dir: string = srcRoot()): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...sourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      files.push(full);
    }
  }
  return files;
}
