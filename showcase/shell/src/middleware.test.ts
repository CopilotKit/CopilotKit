import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parse as parseMatcherPath,
  tokensToRegexp,
} from "next/dist/compiled/path-to-regexp";
import { NextRequest } from "next/server";
import type { NextFetchEvent } from "next/server";

// The statically-imported middleware module emits its table-validation
// warns (duplicate exact sources / duplicate wildcard prefixes) at
// IMPORT time — before any beforeEach spy exists — so they printed raw
// on every run (SU4-A7). vi.hoisted executes before the static imports
// below, swallowing them; the file-level beforeEach re-spies per test
// and afterEach's restoreAllMocks puts the real console.warn back.
vi.hoisted(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

import {
  buildRedirectLookup,
  config,
  DELIBERATE_COLLAPSE_WILDCARD_IDS,
  middleware,
  normalizePosthogHost,
  REGISTRY_FRAMEWORK_SLUGS,
  substituteWildcardTemplate,
  warnIfNoFrameworkSlugs,
} from "./middleware";

const DOCS_HOST = "https://docs.example.test";
const SHELL_ORIGIN = "https://shell.example.test";

function makeEvent(): NextFetchEvent {
  return { waitUntil: vi.fn() } as unknown as NextFetchEvent;
}

function run(pathAndQuery: string, event: NextFetchEvent = makeEvent()) {
  return middleware(new NextRequest(`${SHELL_ORIGIN}${pathAndQuery}`), event);
}

function location(res: Response): URL {
  const loc = res.headers.get("location");
  expect(loc).not.toBeNull();
  return new URL(loc as string);
}

beforeEach(() => {
  vi.stubEnv("DOCS_HOST", DOCS_HOST);
  // An ambient POSTHOG_KEY (developer shell, CI secrets) would make every
  // SEO-redirect test fire a REAL fetch to PostHog — global fetch is only
  // stubbed inside the PostHog describe. Force tracking off by default;
  // tests that exercise tracking stub their own key (and fetch).
  vi.stubEnv("POSTHOG_KEY", "");
  vi.stubEnv("POSTHOG_HOST", "");
  // ALSO stub the NEXT_PUBLIC_ alternates (SU4-A7): readEnvPair treats
  // an empty-string primary as unset and falls through to the alt name,
  // so an ambient NEXT_PUBLIC_POSTHOG_KEY (developer shell, CI secrets)
  // would re-enable REAL PostHog POSTs straight through the
  // empty-string primary stubs above.
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
  // Pin BASE_URL explicitly: runtime-config console.warns once per
  // isolate when it is unset, and the warn-count assertions below only
  // passed because Vitest happens to mirror Vite's BASE_URL="/" into
  // process.env — an implementation detail, not a contract. Without
  // this stub, fresh-imported middleware instances (resetModules
  // re-runs runtime-config's warn-once latches too) would emit an
  // unrelated warn into those counts.
  vi.stubEnv("BASE_URL", "http://localhost:3000");
  // With tracking forced off, the first redirect test trips the
  // statically-imported module's warn-once latch — spy at file level so
  // no real console.warn escapes (restoreAllMocks in afterEach resets it).
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // mockClear is load-bearing (SU5-A6): when console.warn is ALREADY a
  // mock (the vi.hoisted spy, before the first afterEach restores it),
  // spyOn returns that same mock WITHOUT clearing its history — under
  // .only/-t/--shuffle the module-load table warns would poison
  // bare-count assertions (toHaveBeenCalledOnce) in whichever test runs
  // first.
  vi.mocked(console.warn).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("middleware SEO redirects resolve against the docs host (SU-17)", () => {
  it("redirects /faq to the docs host, never to itself on the shell origin", () => {
    const res = run("/faq");
    const dest = location(res);
    // The destination table targets the DOCS routing surface. Resolving
    // against the shell origin makes /faq -> shell /faq, an infinite
    // 301 loop (ERR_TOO_MANY_REDIRECTS in prod).
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/faq");
  });

  it("sends exact-match destinations to the docs host in one hop", () => {
    const res = run("/coagents/quickstart");
    const dest = location(res);
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/langgraph-python/quickstart");
  });

  it("sends wildcard-match destinations to the docs host in one hop", () => {
    const res = run("/troubleshooting/common-issues");
    const dest = location(res);
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/troubleshooting/common-issues");
  });
});

describe("SEO redirects forward the query string (SU-16)", () => {
  it("preserves the query string on exact-match redirects", () => {
    const res = run("/faq?utm_source=newsletter");
    const dest = location(res);
    expect(dest.pathname).toBe("/faq");
    expect(dest.search).toBe("?utm_source=newsletter");
  });

  it("preserves the query string on wildcard-match redirects", () => {
    const res = run("/coagents/foo?utm_source=newsletter&x=1");
    const dest = location(res);
    expect(dest.pathname).toBe("/langgraph-python/foo");
    expect(dest.search).toBe("?utm_source=newsletter&x=1");
  });
});

describe("wildcard sources match the bare path with zero segments (SU-19)", () => {
  // next.config `/x/:path*` semantics: :path* is ZERO or more segments,
  // so the bare /x must redirect too (11 such sources regressed to 404).
  it("redirects /backend (P12) like /backend/:path* with zero segments", () => {
    const res = run("/backend");
    const dest = location(res);
    expect(res.status).toBe(301);
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/backend");
  });

  it("redirects /guides (P11) to /built-in-agent/guides without a trailing slash", () => {
    const dest = location(run("/guides"));
    expect(dest.pathname).toBe("/built-in-agent/guides");
  });

  it("redirects /learn (P3) to /concepts", () => {
    const dest = location(run("/learn"));
    expect(dest.pathname).toBe("/concepts");
  });
});

describe("docs-host redirects at the middleware level (SU-11)", () => {
  it("pins 'mastra' as a registry slug — slug-dependent tests rely on it (SU4-A7)", () => {
    // Several tests in this file (and below) route /mastra/* through
    // the docs-host step. If the registry ever drops or renames the
    // mastra integration, fail HERE with a self-explanatory message
    // instead of as a baffling 301-vs-308 mismatch downstream.
    expect(REGISTRY_FRAMEWORK_SLUGS.has("mastra")).toBe(true);
  });

  it("redirects /docs/:path* to the docs host with the prefix stripped", () => {
    const res = run("/docs/quickstart");
    expect(res.status).toBe(308);
    const dest = location(res);
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/quickstart");
  });

  it("forwards the query string on docs-host redirects", () => {
    const dest = location(run("/docs/quickstart?utm_source=newsletter"));
    expect(dest.pathname).toBe("/quickstart");
    expect(dest.search).toBe("?utm_source=newsletter");
  });

  it("takes precedence over the SEO table (next.config-before-middleware parity)", () => {
    // /docs/api is ALSO an SEO source (R2 -> /reference/v2); the
    // docs-host step must win and strip the /docs prefix instead, like
    // config redirects did.
    const res = run("/docs/api");
    expect(res.status).toBe(308);
    expect(location(res).pathname).toBe("/api");

    // A registry framework slug is docs-host-step territory even when
    // the SEO table has wildcard entries that could match it.
    const slugRes = run("/mastra/quickstart/mastra");
    expect(slugRes.status).toBe(308);
    expect(location(slugRes).pathname).toBe("/mastra/quickstart/mastra");
  });

  it("does not redirect shell-owned routes", () => {
    const res = run("/integrations/mastra");
    expect(res.headers.get("location")).toBeNull();
  });

  it("never lets the SEO table hijack the /integrations namespace (SU3-A1)", () => {
    // /integrations/built-in-agent is a LIVE shell product page (a
    // deployed registry integration, internally linked from
    // search-modal.tsx and integration-explorer.tsx). R15/R17 used to
    // 301 it (and every subpath) to the docs host, hijacking the live
    // page. /integrations/* is a shell-owned namespace — the guard runs
    // FIRST in middleware (SU4-A1), so no redirect step (docs-host OR
    // SEO table) may ever match under it, structurally.
    expect(
      run("/integrations/built-in-agent").headers.get("location"),
    ).toBeNull();
    expect(
      run("/integrations/built-in-agent/agentic-chat").headers.get("location"),
    ).toBeNull();
    expect(run("/integrations").headers.get("location")).toBeNull();
  });

  it("guards /integrations even if 'integrations' appears as a registry slug (SU4-A1)", () => {
    // Before the hoist, the guard ran AFTER the docs-host redirect: the
    // protection was data-dependent — a registry slug literally named
    // "integrations" would have let step 1 308 live shell pages to the
    // docs host before the guard executed. Stub the slug set to contain
    // it and prove the guard is structural.
    //
    // Shared-state hygiene (SU5-A6): REGISTRY_FRAMEWORK_SLUGS is the
    // live module-level Set every other test in this worker reads.
    // Capture whether the slug pre-existed and only delete what THIS
    // test added — an unconditional finally-delete would erase a real
    // registry slug for the rest of the run if one ever appeared.
    const had = REGISTRY_FRAMEWORK_SLUGS.has("integrations");
    // Precondition: the stub below is only meaningful while the real
    // registry does NOT claim the slug (if it ever does, the guard's
    // structural claim needs re-proving with a different slug).
    expect(had).toBe(false);
    REGISTRY_FRAMEWORK_SLUGS.add("integrations");
    try {
      expect(
        run("/integrations/built-in-agent").headers.get("location"),
      ).toBeNull();
      expect(run("/integrations").headers.get("location")).toBeNull();
      expect(run("/Integrations/anything").headers.get("location")).toBeNull();
    } finally {
      if (!had) REGISTRY_FRAMEWORK_SLUGS.delete("integrations");
    }
  });
});

describe("case-insensitive matching parity (SU3-A4)", () => {
  // The next.config rules this layer replaced were compiled by
  // path-to-regexp with sensitive:false — /FAQ and /Mastra/quickstart
  // matched. The middleware port's Map/startsWith/Set lookups are
  // case-sensitive and regressed those URLs to 404. Matching is now
  // case-insensitive; the wildcard remainder keeps its ORIGINAL case
  // (path-to-regexp preserves matched-param case in destinations).
  it("redirects /FAQ exactly like /faq", () => {
    const res = run("/FAQ");
    expect(res.status).toBe(301);
    const dest = location(res);
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/faq");
  });

  it("forwards /Mastra/Quickstart to the docs host with the original-case tail", () => {
    const res = run("/Mastra/Quickstart");
    expect(res.status).toBe(308);
    const dest = location(res);
    expect(dest.origin).toBe(DOCS_HOST);
    // Slug literal is canonical lowercase; the matched remainder keeps
    // its original case, exactly as a path-to-regexp :path* param did.
    expect(dest.pathname).toBe("/mastra/Quickstart");
  });

  it("matches SEO wildcard prefixes case-insensitively, keeping the rest's case", () => {
    const res = run("/Coagents/Foo");
    expect(res.status).toBe(301);
    expect(location(res).pathname).toBe("/langgraph-python/Foo");
  });

  it("matches kept docs prefixes (/AG-UI) and /DOCS case-insensitively", () => {
    const agui = run("/AG-UI/Events");
    expect(agui.status).toBe(308);
    expect(location(agui).pathname).toBe("/ag-ui/Events");

    const docs = run("/DOCS/Quickstart");
    expect(docs.status).toBe(308);
    expect(location(docs).pathname).toBe("/Quickstart");
  });

  it("still guards the /integrations namespace case-insensitively", () => {
    expect(
      run("/Integrations/built-in-agent").headers.get("location"),
    ).toBeNull();
  });
});

describe("trailing-slash normalization for matching (SU3-A5)", () => {
  it("redirects /faq/ via the exact entry in ONE hop (no 308 detour)", () => {
    // A trailing slash missed the exact map, falling through to Next's
    // own trailing-slash 308 — an extra hop for every such URL.
    const res = run("/faq/");
    expect(res.status).toBe(301);
    const dest = location(res);
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/faq");
  });

  it("attributes /coagents/ to the exact entry L1, not the wildcard L12", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = run("/coagents/");
    expect(location(res).pathname).toBe("/langgraph-python");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.properties.redirect_id).toBe("L1");
  });

  it("does not strip the root path", () => {
    expect(run("/").headers.get("location")).toBeNull();
  });

  it("strips a WHOLE trailing-slash run, not just one slash (SU4-A3)", () => {
    // slice(0, -1) only removed ONE slash: "/faq//" became "/faq/" and
    // still missed the exact map.
    const res = run("/faq//");
    expect(res.status).toBe(301);
    expect(location(res).pathname).toBe("/faq");
    expect(location(run("/coagents///")).pathname).toBe("/langgraph-python");
  });
});

describe("leading-slash runs are collapsed for matching (SU4-A3)", () => {
  // "//docs/foo" and "//ag-ui/x" fell through the docs-host step's
  // strict ===/startsWith branches (only the framework-slug regex
  // tolerated runs) AND missed the SEO wildcard scan → 404. The run is
  // collapsed once in middleware() for ALL matching steps.
  it("redirects //docs/foo like /docs/foo (308, prefix stripped)", () => {
    const res = run("//docs/foo");
    expect(res.status).toBe(308);
    const dest = location(res);
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/foo");
  });

  it("redirects //ag-ui/x like /ag-ui/x (prefix kept)", () => {
    const res = run("//ag-ui/x");
    expect(res.status).toBe(308);
    expect(location(res).pathname).toBe("/ag-ui/x");
  });

  it("redirects ///coagents/foo through the SEO wildcard scan", () => {
    const res = run("///coagents/foo");
    expect(res.status).toBe(301);
    expect(location(res).pathname).toBe("/langgraph-python/foo");
  });

  it("still guards the /integrations namespace behind a slash run", () => {
    expect(run("//integrations/mastra").headers.get("location")).toBeNull();
  });

  it("collapses an all-slash path to root and passes it through", () => {
    expect(run("///").headers.get("location")).toBeNull();
  });
});

describe("table-entry pins (SU3-A6)", () => {
  it("matches MG3's uppercase source against the lowercase live URL", () => {
    // The table source is "/migration-guides/1.10.X" (uppercase X) but
    // live URLs are lowercase — before case-insensitive matching (SU3-A4
    // lowercases BOTH the table keys and the request path) this entry
    // could never fire.
    expect(location(run("/migration-guides/1.10.x")).pathname).toBe(
      "/migrate/v2",
    );
    expect(location(run("/migration-guides/1.10.X")).pathname).toBe(
      "/migrate/v2",
    );
  });

  it("keeps the framework segment on F13 like every comparable rule", () => {
    // F13 dropped the framework segment (→ /human-in-the-loop), unlike
    // F11/F12, the S× renames and the P1×aws-strands catch-all, which
    // all map onto the canonical slug (aws-strands → strands).
    expect(location(run("/aws-strands/human-in-the-loop")).pathname).toBe(
      "/strands/human-in-the-loop",
    );
  });
});

describe("redirect status codes (SU-2)", () => {
  it("emits 308 for docs-host redirects, matching next.config permanent:true", () => {
    // The removed next.config rules used `permanent: true`, which Next
    // emits as 308 — a 1:1 port must keep the status code.
    expect(run("/docs/quickstart").status).toBe(308);
    expect(run("/ag-ui").status).toBe(308);
  });

  it("keeps 301 for SEO-table redirects (their original middleware status)", () => {
    expect(run("/faq").status).toBe(301);
    expect(run("/coagents/foo").status).toBe(301);
  });
});

describe("matcher boundaries (SU-15)", () => {
  // Compile the matcher EXACTLY as Next does (SU6-A6 — see
  // tryToParsePath in next/dist/lib/try-to-parse-path.ts, which
  // getMiddlewareMatchers uses at build): parse() + tokensToRegexp()
  // with NO options, keeping only the regex SOURCE — the build manifest
  // stores `.source` and the runtime re-hydrates it with
  // `new RegExp(matcher.regexp)` (middleware-route-matcher.ts),
  // DROPPING the `i` flag that tokensToRegexp's sensitive:false default
  // implies. Runtime matcher matching is therefore case-SENSITIVE. The
  // previous homemade option set ({ delimiter: "/", sensitive: false,
  // strict: true }) was NOT what Next uses and diverged on exactly that
  // class of input (a case-variant of an excluded prefix).
  const matcherRe = new RegExp(
    tokensToRegexp(parseMatcherPath(config.matcher[0])).source,
  );

  it("pins a single matcher entry — every boundary below compiles config.matcher[0] only (SU7-F3)", () => {
    // A second matcher entry would be entirely untested by this
    // describe (matcherRe compiles only the first); fail HERE with a
    // self-explanatory message instead of silently green-lighting an
    // unverified pattern.
    expect(config.matcher).toHaveLength(1);
  });

  it("runs middleware on /api and /api-reference (SEO sources R1/R3)", () => {
    expect(matcherRe.test("/api")).toBe(true);
    expect(matcherRe.test("/api-reference")).toBe(true);
  });

  it("still excludes real API routes and internals", () => {
    expect(matcherRe.test("/api/runtime")).toBe(false);
    expect(matcherRe.test("/_next/static/chunk.js")).toBe(false);
    expect(matcherRe.test("/_next/image")).toBe(false);
    expect(matcherRe.test("/previews/foo")).toBe(false);
    expect(matcherRe.test("/favicon.ico")).toBe(false);
  });

  it("excludes ALL _next/* internals wholesale (SU4-A6)", () => {
    // The old `_next/static|_next/image` pair let /_next/data and every
    // other /_next/* internal run the middleware for nothing — no table
    // source or registry slug starts with `_next`.
    expect(matcherRe.test("/_next/data/build-id/foo.json")).toBe(false);
    expect(matcherRe.test("/_next/postponed/resume")).toBe(false);
    // A lookalike OUTSIDE the _next/ prefix still runs the middleware.
    expect(matcherRe.test("/_nextdoor")).toBe(true);
  });

  it("matches case-SENSITIVELY, like Next's runtime regexp (SU6-A6)", () => {
    // The runtime rebuilds the matcher with `new RegExp(source)` — no
    // `i` flag — so a case-variant of an excluded prefix still reaches
    // the middleware (which then passes it through; no table source
    // starts with /API or /_NEXT).
    expect(matcherRe.test("/API/runtime")).toBe(true);
    expect(matcherRe.test("/_NEXT/static/chunk.js")).toBe(true);
  });

  it("lets bare /api/ (trailing slash) reach middleware for the single-hop R1 redirect (SU5-A4)", () => {
    // The blanket `api/` exclusion also swallowed the BARE "/api/":
    // Next then 308'd it to /api (trailing-slash normalization) before
    // R1 could 301 — a needless double hop. Narrowed to `api/.+`, the
    // bare trailing-slash form reaches middleware and R1 redirects in
    // ONE hop; real API routes (/api/<anything>) stay excluded.
    expect(matcherRe.test("/api/")).toBe(true);
    const res = run("/api/");
    expect(res.status).toBe(301);
    const dest = location(res);
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/reference/v2");
  });

  it("redirects /api and /api-reference to /reference/v2 on the docs host", () => {
    const apiDest = location(run("/api"));
    expect(apiDest.origin).toBe(DOCS_HOST);
    expect(apiDest.pathname).toBe("/reference/v2");
    const apiRefDest = location(run("/api-reference"));
    expect(apiRefDest.pathname).toBe("/reference/v2");
  });
});

describe("REGISTRY_FRAMEWORK_SLUGS lowercase-normalizes registry slugs (SU4-A4)", () => {
  afterEach(() => {
    vi.doUnmock("@/data/registry.json");
    vi.resetModules();
  });

  it("matches a mixed-case registry slug after construction-time lowercasing", async () => {
    // docs-redirects compares the LOWERCASED first segment against the
    // set — a mixed-case slug stored verbatim would silently never
    // match, disabling its docs-host redirect with no signal.
    vi.resetModules();
    vi.doMock("@/data/registry.json", () => ({
      default: { integrations: [{ slug: "MiXedCase" }] },
    }));
    const fresh = await import("./middleware");
    expect(fresh.REGISTRY_FRAMEWORK_SLUGS.has("mixedcase")).toBe(true);
    const res = fresh.middleware(
      new NextRequest(`${SHELL_ORIGIN}/MixedCase/quickstart`),
      makeEvent(),
    );
    expect(res.status).toBe(308);
    expect(location(res).pathname).toBe("/mixedcase/quickstart");
  });
});

describe("REGISTRY_FRAMEWORK_SLUGS survives a malformed registry (SU5-A1)", () => {
  // Module-load defensiveness: the slug-set construction used to do
  // `i.slug.toLowerCase()` through a bare `as` cast — a registry that is
  // null, has a non-array `integrations`, or contains entries with a
  // missing/non-string slug would TypeError at MODULE LOAD: the exact
  // 500-every-request failure warnIfNoFrameworkSlugs exists to prevent.
  afterEach(() => {
    vi.doUnmock("@/data/registry.json");
    vi.resetModules();
  });

  async function importWithRegistry(registryShape: unknown) {
    vi.resetModules();
    vi.doMock("@/data/registry.json", () => ({ default: registryShape }));
    return import("./middleware");
  }

  it("imports without throwing when the registry is null", async () => {
    const fresh = await importWithRegistry(null);
    expect(fresh.REGISTRY_FRAMEWORK_SLUGS.size).toBe(0);
  });

  it("imports without throwing when integrations is not an array", async () => {
    const fresh = await importWithRegistry({ integrations: "corrupt" });
    expect(fresh.REGISTRY_FRAMEWORK_SLUGS.size).toBe(0);
  });

  it("drops entries with a missing or non-string slug and warns, keeping valid ones", async () => {
    const fresh = await importWithRegistry({
      integrations: [
        { slug: "Good" },
        { name: "no-slug-key" },
        { slug: 42 },
        null,
      ],
    });
    expect(fresh.REGISTRY_FRAMEWORK_SLUGS.has("good")).toBe(true);
    expect(fresh.REGISTRY_FRAMEWORK_SLUGS.size).toBe(1);
    // The drop is observable next to warnIfNoFrameworkSlugs's module-load
    // guard — a silently-shrunken slug set disables docs-host redirects
    // with no signal otherwise.
    const dropWarns = vi
      .mocked(console.warn)
      .mock.calls.filter(([msg]) =>
        String(msg).includes("dropped from the framework-slug set"),
      );
    expect(dropWarns).toHaveLength(1);
    // Count-phrase match (SU6-A6): a bare toContain("3") would match a
    // "3" anywhere in the message (ids, paths, "SU3-..."), not the
    // dropped-entry count.
    expect(String(dropWarns[0][0])).toContain("has 3 integration");
  });

  it("stays silent about drops for a fully well-formed registry", async () => {
    await importWithRegistry({ integrations: [{ slug: "fine" }] });
    const dropWarns = vi
      .mocked(console.warn)
      .mock.calls.filter(([msg]) =>
        String(msg).includes("dropped from the framework-slug set"),
      );
    expect(dropWarns).toHaveLength(0);
  });
});

describe("empty framework-slug set guard (SU-20)", () => {
  it("console.errors in production when the slug set is empty", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    warnIfNoFrameworkSlugs(new Set());
    // Message-filtered count (SU6-A6, applied SU7-F3): a bare
    // toHaveBeenCalledOnce() would absorb any unrelated error into this
    // count — or mask a missing slug error when exactly one unrelated
    // error fired.
    const slugErrors = error.mock.calls.filter(([msg]) =>
      String(msg).includes("ZERO framework slugs"),
    );
    expect(slugErrors).toHaveLength(1);
  });

  it("console.warns outside production when the slug set is empty", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfNoFrameworkSlugs(new Set());
    // Message-filtered count (SU6-A6): a bare toHaveBeenCalledOnce()
    // would absorb any unrelated warn into this count.
    const slugWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("ZERO framework slugs"),
    );
    expect(slugWarns).toHaveLength(1);
  });

  it("stays silent when slugs are present", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfNoFrameworkSlugs(new Set(["mastra"]));
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("docs-redirects-disabled sentinel consumer (SU4-B2)", () => {
  // middleware.ts keeps a module-level warn-once latch
  // (docsRedirectsDisabledWarned) — reset modules and import a fresh
  // middleware per test so this describe owns the latch (same pattern
  // as the PostHog tracking-lifetime describe below).
  let freshMiddleware: typeof middleware;

  beforeEach(async () => {
    // Shell deployed AT the default docs host with DOCS_HOST pointing
    // there too: the configured value is rejected (self-host) AND the
    // DEFAULT_DOCS_HOST fallback carries the identical defect, so
    // runtime-config hands middleware the DOCS_REDIRECTS_DISABLED_HOST
    // sentinel instead of a looping host.
    vi.stubEnv("BASE_URL", "https://docs.showcase.copilotkit.ai");
    vi.stubEnv("DOCS_HOST", "https://docs.showcase.copilotkit.ai");
    // The FATAL-CONFIG console.error asserted below is the PROD posture
    // — readDocsHost branches dev-vs-prod (dev logs a warn instead).
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    ({ middleware: freshMiddleware } = await import("./middleware"));
    // Fresh import re-runs module-load warnings into the file-level
    // warn spy — clear them so the once-assertions below only count
    // request-time warns.
    vi.mocked(console.warn).mockClear();
  });

  it("skips the docs-host step (no 308 to the sentinel) and warns once", () => {
    // runtime-config console.errors its FATAL-CONFIG diagnosis at
    // request time (fresh latches after resetModules) — swallow it so
    // nothing prints raw, and assert it fired.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentinelWarns = () =>
      vi
        .mocked(console.warn)
        .mock.calls.filter((c) =>
          String(c[0]).includes("docs redirects are DISABLED"),
        );

    const first = freshMiddleware(
      new NextRequest(`${SHELL_ORIGIN}/docs/foo`),
      makeEvent(),
    );
    // The redirect steps are skipped entirely: /docs/foo would normally
    // 308 to the docs host (and the SEO DOCS-wild entry would otherwise
    // 301 it to the same docsHost) — with the sentinel the request
    // passes straight through to NextResponse.next(), never a redirect
    // to the guaranteed-dead `.invalid` sentinel origin.
    expect(first.headers.get("location")).toBeNull();
    expect(first.status).toBe(200);
    expect(sentinelWarns()).toHaveLength(1);
    expect(
      error.mock.calls.some((c) => String(c[0]).includes("FATAL-CONFIG")),
    ).toBe(true);

    // Second request: still no redirect, and the warn-once latch holds.
    const second = freshMiddleware(
      new NextRequest(`${SHELL_ORIGIN}/docs/bar`),
      makeEvent(),
    );
    expect(second.headers.get("location")).toBeNull();
    expect(sentinelWarns()).toHaveLength(1);
  });
});

describe("PostHog tracking lifetime (SU-14)", () => {
  // middleware.ts keeps a module-level warn-once latch (posthogKeyWarned).
  // On the statically-imported instance, whichever earlier test triggered
  // the first no-key redirect already consumed it, which makes the warn
  // path untestable here — reset modules and import a fresh middleware
  // per test so this describe owns the latch.
  let freshMiddleware: typeof middleware;

  beforeEach(async () => {
    vi.resetModules();
    ({ middleware: freshMiddleware } = await import("./middleware"));
    // The fresh import re-runs module-load warnings (e.g. the duplicate
    // exact-sources warn from SU2-A3) into the file-level warn spy —
    // clear them so assertions below only count request-time warns.
    vi.mocked(console.warn).mockClear();
  });

  function runFresh(pathAndQuery: string, event: NextFetchEvent) {
    return freshMiddleware(
      new NextRequest(`${SHELL_ORIGIN}${pathAndQuery}`),
      event,
    );
  }

  it("registers the tracking fetch with event.waitUntil", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
    vi.stubGlobal("fetch", fetchMock);
    const event = makeEvent();
    runFresh("/faq", event);
    expect(fetchMock).toHaveBeenCalledOnce();
    // Without waitUntil the Edge runtime may terminate right after the
    // redirect response, dropping the in-flight capture.
    expect(event.waitUntil).toHaveBeenCalledOnce();
  });

  it("warns exactly once and skips fetch/waitUntil when tracking is disabled (no POSTHOG_KEY)", () => {
    // POSTHOG_KEY is already stubbed to "" by the file-level beforeEach.
    const warn = vi.spyOn(console, "warn");
    const fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
    vi.stubGlobal("fetch", fetchMock);
    const first = makeEvent();
    const second = makeEvent();
    runFresh("/faq", first);
    runFresh("/learn", second);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(first.waitUntil).not.toHaveBeenCalled();
    expect(second.waitUntil).not.toHaveBeenCalled();
    // The latch warns once per cold start, not once per request.
    // Filter by message: a bare toHaveBeenCalledOnce() would absorb any
    // unrelated warn (module-load table warns, runtime-config fallbacks)
    // into this count and fail — or worse, mask a missing key warn when
    // exactly one unrelated warn fired.
    const keyWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("POSTHOG_KEY"),
    );
    expect(keyWarns).toHaveLength(1);
  });

  it("console.errors (not warns) in production when POSTHOG_KEY is missing (SU4-A5)", () => {
    // Mirrors warnIfNoFrameworkSlugs's NODE_ENV branching: on dev /
    // preview deploys a missing key is legitimate, but in production it
    // is a wiring bug that silently under-counts the decommission
    // report — it must hit the error stream.
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn");
    const event = makeEvent();
    runFresh("/faq", event);
    const keyErrors = error.mock.calls.filter(([msg]) =>
      String(msg).includes("POSTHOG_KEY"),
    );
    expect(keyErrors).toHaveLength(1);
    expect(String(keyErrors[0][0])).toContain("wiring bug");
    const keyWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("POSTHOG_KEY"),
    );
    expect(keyWarns).toHaveLength(0);
  });

  it("console.warns (not errors) outside production when POSTHOG_KEY is missing (SU4-A5)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn");
    const event = makeEvent();
    runFresh("/faq", event);
    const keyWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("POSTHOG_KEY"),
    );
    expect(keyWarns).toHaveLength(1);
    const keyErrors = error.mock.calls.filter(([msg]) =>
      String(msg).includes("POSTHOG_KEY"),
    );
    expect(keyErrors).toHaveLength(0);
  });

  it("surfaces the missing-key wiring bug on the FIRST request, even when no redirect fires (SU6-A5)", () => {
    // The check used to live inside trackRedirect, which only runs when
    // a redirect MATCHES — a prod deploy whose traffic never hits a
    // redirect source got ZERO signal that every seo_redirect would go
    // uncaptured. It now runs at config-resolution time on every
    // middleware invocation (latched once per isolate).
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const keyErrors = () =>
      error.mock.calls.filter(([msg]) => String(msg).includes("POSTHOG_KEY"));
    // A pass-through path: no redirect step matches it.
    const res = runFresh("/integrations/built-in-agent", makeEvent());
    expect(res.headers.get("location")).toBeNull();
    expect(keyErrors()).toHaveLength(1);
    // Second request: the once-latch holds.
    runFresh("/integrations/built-in-agent", makeEvent());
    expect(keyErrors()).toHaveLength(1);
  });

  it("does NOT capture PostHog events for docs-host redirects (parity pin)", () => {
    // Deliberate parity choice (see the docs-host step): the next.config
    // `redirects()` rules these replace were never tracked — only the
    // SEO table calls trackRedirect. Pin it so a future refactor doesn't
    // silently start double-counting docs traffic as seo_redirect events.
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
    vi.stubGlobal("fetch", fetchMock);
    const event = makeEvent();
    const res = runFresh("/docs/quickstart", event);
    expect(res.status).toBe(308);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(event.waitUntil).not.toHaveBeenCalled();
  });
});

describe("duplicate exact sources: first match wins (SU2-A3)", () => {
  it("attributes /unselected to SR-root×unselected, not the later P2× entry", () => {
    // The table doc says "first match wins"; a Map last-write-wins build
    // inverted that and skewed PostHog redirect_id attribution for the
    // duplicate sources (P2×unselected overrode SR-root×unselected).
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = run("/unselected");
    expect(location(res).pathname).toBe("/built-in-agent");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.properties.redirect_id).toBe("SR-root×unselected");
  });

  it("rejects wildcard sources whose prefix lacks a '/' boundary (SU2-A7v)", () => {
    // Without the boundary, `startsWith(prefix)` would match prefix
    // LOOKALIKES (e.g. "/x:path*" matching "/xylophone").
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wildcardEntries } = buildRedirectLookup([
      { id: "bad", source: "/x:path*", destination: "/y/:path*" },
      { id: "good", source: "/a/:path*", destination: "/b/:path*" },
    ]);
    expect(wildcardEntries).toHaveLength(1);
    expect(wildcardEntries[0].id).toBe("good");
    // Message-filtered count (SU6-A6): a bare toHaveBeenCalledOnce()
    // would absorb any unrelated warn into this count.
    const malformedWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("malformed wildcard"),
    );
    expect(malformedWarns).toHaveLength(1);
    expect(String(malformedWarns[0][0])).toContain("/x:path*");
  });

  it("applies first-match-wins + warn to duplicate WILDCARD prefixes (SU3-A2)", () => {
    // Exact sources got first-match-wins + a module-load warn in round 2;
    // wildcard sources have the same shadowing problem (six SR-wild×
    // prefixes duplicate the later P1× entries). Without dedup the
    // shadowed ids silently get zero traffic attribution — and the
    // decommission report then proposes deleting a LIVE redirect.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wildcardEntries } = buildRedirectLookup([
      { id: "first-wild", source: "/x/:path*", destination: "/a/:path*" },
      { id: "second-wild", source: "/x/:path*", destination: "/b/:path*" },
      { id: "other", source: "/y/:path*", destination: "/c/:path*" },
    ]);
    expect(wildcardEntries).toHaveLength(2);
    expect(wildcardEntries[0].id).toBe("first-wild");
    expect(wildcardEntries[1].id).toBe("other");
    const dupWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("duplicate wildcard"),
    );
    expect(dupWarns).toHaveLength(1);
    expect(String(dupWarns[0][0])).toContain("second-wild");
    expect(String(dupWarns[0][0])).toContain("first-wild");
  });

  it("attributes /langgraph/foo to SR-wild×langgraph, not the later P1× entry (SU3-A2)", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = run("/langgraph/foo");
    expect(location(res).pathname).toBe("/langgraph-python/foo");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.properties.redirect_id).toBe("SR-wild×langgraph");
  });

  it("keeps the first entry and warns once, naming the duplicate keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap } = buildRedirectLookup([
      { id: "first", source: "/dup", destination: "/x" },
      { id: "second", source: "/dup", destination: "/y" },
      { id: "only", source: "/solo", destination: "/z" },
    ]);
    expect(exactMap.get("/dup")?.id).toBe("first");
    expect(exactMap.get("/dup")?.destination).toBe("/x");
    expect(exactMap.get("/solo")?.id).toBe("only");
    // Message-filtered count (SU6-A6): a bare toHaveBeenCalledOnce()
    // would absorb any unrelated warn into this count.
    const dupWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("duplicate exact sources"),
    );
    expect(dupWarns).toHaveLength(1);
    expect(String(dupWarns[0][0])).toContain("/dup");
    expect(String(dupWarns[0][0])).toContain("second");
  });
});

describe("buildRedirectLookup rejects malformed entries (SU3-A3)", () => {
  it("skips+warns wildcard sources with segments AFTER :path*", () => {
    // "/x/:path*/y" silently truncated to prefix "/x/" — over-matching
    // every /x/* path instead of only /x/*/y shapes.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wildcardEntries } = buildRedirectLookup([
      { id: "trailing", source: "/x/:path*/y", destination: "/z/:path*" },
      { id: "good", source: "/a/:path*", destination: "/b/:path*" },
    ]);
    expect(wildcardEntries).toHaveLength(1);
    expect(wildcardEntries[0].id).toBe("good");
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("/x/:path*/y"),
    );
    expect(warns).toHaveLength(1);
  });

  it("rejects+warns a root wildcard source /:path* (would hijack the entire site)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wildcardEntries } = buildRedirectLookup([
      { id: "root-wild", source: "/:path*", destination: "/y/:path*" },
    ]);
    expect(wildcardEntries).toHaveLength(0);
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("root-wild"),
    );
    expect(warns).toHaveLength(1);
  });

  it("rejects+warns a root EXACT source '/' — it would hijack the homepage (SU7-F3)", () => {
    // The twin of the root-wildcard guard: "/" passes every source
    // check (starts with "/", no "//", no ?/#, length-1 so the
    // trailing-slash guard skips it) and lands in the exact map, where
    // it matches the HOMEPAGE — never a legitimate SEO entry.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap } = buildRedirectLookup([
      { id: "root-exact", source: "/", destination: "/y" },
      { id: "ok", source: "/ok", destination: "/fine" },
    ]);
    expect(exactMap.has("/")).toBe(false);
    expect(exactMap.size).toBe(1);
    expect(exactMap.get("/ok")?.id).toBe("ok");
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("hijack the homepage"),
    );
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain("root-exact");
    expect(String(warns[0][0])).not.toContain("(ok)");
  });

  it("skips+warns destinations that are not root-relative or carry ?/#", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap, wildcardEntries } = buildRedirectLookup([
      // Absolute URL: would be mangled into a docs-host path
      // ("https://<docsHost>https://evil.test/x").
      { id: "abs", source: "/abs", destination: "https://evil.test/x" },
      // "?" query: silently wiped by the per-request search overwrite.
      { id: "query", source: "/query", destination: "/q?x=y" },
      // "#" fragment: same overwrite/mangling class.
      { id: "frag", source: "/frag", destination: "/f#sec" },
      { id: "wild-q", source: "/wq/:path*", destination: "/w/:path*?x=y" },
      // "//" run (SU6-A4): request-time normalizeRedirectPath WOULD
      // collapse it (so it can never become a scheme-relative open
      // redirect — SU-18), but an authored "//" is a presumed typo,
      // same as in sources — reject it loudly instead of silently
      // papering over it.
      { id: "dbl", source: "/dbl", destination: "/a//b" },
      { id: "wild-dbl", source: "/wd/:path*", destination: "//w/:path*" },
      { id: "ok", source: "/ok", destination: "/fine" },
    ]);
    expect(exactMap.size).toBe(1);
    expect(exactMap.get("/ok")?.id).toBe("ok");
    expect(wildcardEntries).toHaveLength(0);
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("invalid destination"),
    );
    expect(warns).toHaveLength(1);
    for (const id of ["abs", "query", "frag", "wild-q", "dbl", "wild-dbl"]) {
      expect(String(warns[0][0])).toContain(id);
    }
  });

  it("rejects+warns sources containing '//' — '//:path*' bypasses the root-wildcard guard (SU5-A2)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap, wildcardEntries } = buildRedirectLookup([
      // "//:path*" passed every builder check (prefix "//" ends with
      // "/", :path* terminates the source, prefix !== "/") — but the
      // matcher derives bareSource = prefix minus one slash = "/", so
      // the entry matched the HOMEPAGE: the exact hijack the
      // root-wildcard guard exists to reject.
      { id: "root-bypass", source: "//:path*", destination: "/y/:path*" },
      // A leading-"//" exact source is unreachable too — middleware
      // collapses leading slash runs before any lookup — and previously
      // sat in the table as a silent dead entry with no warn.
      { id: "dead-exact", source: "//x", destination: "/x" },
      { id: "ok", source: "/ok", destination: "/fine" },
    ]);
    expect(wildcardEntries).toHaveLength(0);
    expect(exactMap.size).toBe(1);
    expect(exactMap.get("/ok")?.id).toBe("ok");
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("invalid source"),
    );
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain("root-bypass");
    expect(String(warns[0][0])).toContain("dead-exact");
  });

  it("skips+warns sources that are not root-relative or carry ?/# (SU4-A2)", () => {
    // NextRequest pathnames always start with "/" and never carry a
    // query/fragment — such a source can never match.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap, wildcardEntries } = buildRedirectLookup([
      { id: "no-slash", source: "faq", destination: "/faq" },
      { id: "query", source: "/q?x=y", destination: "/q" },
      { id: "frag", source: "/f#sec", destination: "/f" },
      { id: "wild-no-slash", source: "x/:path*", destination: "/y/:path*" },
      { id: "ok", source: "/ok", destination: "/fine" },
    ]);
    expect(exactMap.size).toBe(1);
    expect(exactMap.get("/ok")?.id).toBe("ok");
    expect(wildcardEntries).toHaveLength(0);
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("invalid source"),
    );
    expect(warns).toHaveLength(1);
    for (const id of ["no-slash", "query", "frag", "wild-no-slash"]) {
      expect(String(warns[0][0])).toContain(id);
    }
  });

  it("rejects+warns entries whose source or destination contains non-printable-ASCII (SU7-F3)", () => {
    // NextRequest pathnames are percent-encoded ASCII, so a source with
    // a raw space or a non-ASCII character can never match — previously
    // a silent dead entry. The check also enforces the ASCII
    // length-preservation assumption the positional-slicing comments
    // rely on (toLowerCase is only guaranteed length-preserving for
    // ASCII).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap, wildcardEntries } = buildRedirectLookup([
      { id: "space-src", source: "/with space", destination: "/y" },
      { id: "uni-src", source: "/café", destination: "/y" },
      { id: "uni-dest", source: "/ok-src", destination: "/naïve" },
      { id: "wild-uni", source: "/wü/:path*", destination: "/y/:path*" },
      { id: "ok", source: "/ok", destination: "/fine" },
    ]);
    expect(exactMap.size).toBe(1);
    expect(exactMap.get("/ok")?.id).toBe("ok");
    expect(wildcardEntries).toHaveLength(0);
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("non-printable-ASCII"),
    );
    expect(warns).toHaveLength(1);
    for (const id of ["space-src", "uni-src", "uni-dest", "wild-uni"]) {
      expect(String(warns[0][0])).toContain(id);
    }
    expect(String(warns[0][0])).not.toContain("(ok)");
  });

  it("skips+warns trailing-slash exact sources — unreachable after stripping (SU4-A2)", () => {
    // matchPath strips trailing slashes before the exact lookup, so a
    // "/faq/" key can never be queried.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap } = buildRedirectLookup([
      { id: "trail", source: "/faq/", destination: "/faq" },
      { id: "ok", source: "/ok", destination: "/fine" },
    ]);
    expect(exactMap.size).toBe(1);
    expect(exactMap.get("/ok")?.id).toBe("ok");
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("trailing"),
    );
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain("trail");
  });

  it("skips+warns EXACT entries whose destination contains :path* (SU4-A2)", () => {
    // Exact matches never substitute — the literal token would leak
    // into the Location header.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap } = buildRedirectLookup([
      { id: "leak", source: "/leak", destination: "/x/:path*" },
      { id: "ok", source: "/ok", destination: "/fine" },
    ]);
    expect(exactMap.size).toBe(1);
    expect(exactMap.get("/ok")?.id).toBe("ok");
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("literal token"),
    );
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain("leak");
  });

  it("warns when a wildcard prefix falls under an EARLIER wildcard prefix (SU4-A2)", () => {
    // First-match-wins scan: the longer, later prefix is unreachable —
    // zero PostHog traffic, wrongful-decommission class.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wildcardEntries } = buildRedirectLookup([
      { id: "broad", source: "/x/:path*", destination: "/a/:path*" },
      { id: "narrow", source: "/x/sub/:path*", destination: "/b/:path*" },
      // The inverse order (more specific FIRST) is normal and silent.
      { id: "specific", source: "/y/sub/:path*", destination: "/c/:path*" },
      { id: "general", source: "/y/other/:path*", destination: "/d/:path*" },
    ]);
    expect(wildcardEntries).toHaveLength(4);
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("EARLIER wildcard prefix —"),
    );
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain("narrow");
    expect(String(warns[0][0])).toContain("broad");
    expect(String(warns[0][0])).not.toContain("specific");
  });

  it("raises ZERO validation warns on the real table (SU5-A3 health pin)", async () => {
    // Health pin for the live seoRedirects table: the deliberate twins
    // (P2× behind SR-root×, P1× behind SR-wild× — same destinations)
    // are allowlisted as same-destination duplicates and no longer fire
    // the table-bug warn channel on every cold start (which was
    // desensitizing the signal). EVERY validation class must therefore
    // be at zero — ANY warn here means a table regression.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { seoRedirects } = await import("@/lib/seo-redirects");
    buildRedirectLookup(seoRedirects);
    const classes = warn.mock.calls
      .map(([msg]) => String(msg))
      .filter((msg) => msg.includes("[middleware] seo-redirects"));
    expect(classes).toEqual([]);
  });

  it("silently skips same-destination duplicates — the documented twin allowlist (SU5-A3)", () => {
    // The SR-wild×/P1× and SR-root×/P2× twins are DELIBERATE table
    // entries with identical destinations: warning on them at every
    // cold start desensitized the duplicate warn channel. A duplicate
    // whose destination matches the first claimant is harmless (same
    // redirect, first id keeps the PostHog attribution) — skip it
    // silently; only UNEXPECTED (different-destination) duplicates warn.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap, wildcardEntries } = buildRedirectLookup([
      { id: "SR-root×x", source: "/x", destination: "/y" },
      { id: "P2×x", source: "/x", destination: "/y" },
      { id: "SR-wild×x", source: "/x/:path*", destination: "/y/:path*" },
      { id: "P1×x", source: "/x/:path*", destination: "/y/:path*" },
    ]);
    expect(exactMap.get("/x")?.id).toBe("SR-root×x");
    expect(wildcardEntries).toHaveLength(1);
    expect(wildcardEntries[0].id).toBe("SR-wild×x");
    const dupWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("duplicate"),
    );
    expect(dupWarns).toHaveLength(0);
  });

  it("detects the :path* token case-insensitively (SU5-A3)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap, wildcardEntries } = buildRedirectLookup([
      // A miscased token fell through indexOf(":path*") and became a
      // silent dead EXACT entry keyed "/x/:path*".
      { id: "upper-wild", source: "/x/:PATH*", destination: "/a/:path*" },
      // A miscased token in an EXACT destination slipped past the
      // literal-token check and leaked into the Location header.
      { id: "upper-dest", source: "/leak", destination: "/x/:Path*" },
    ]);
    expect(wildcardEntries).toHaveLength(1);
    expect(wildcardEntries[0].id).toBe("upper-wild");
    expect(wildcardEntries[0].prefix).toBe("/x/");
    expect(exactMap.size).toBe(0);
    const leakWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("literal token"),
    );
    expect(leakWarns).toHaveLength(1);
    expect(String(leakWarns[0][0])).toContain("upper-dest");
  });

  it("rejects+warns WILDCARD destinations whose :path* token is miscased (SU6-A1)", () => {
    // Substitution (substituteWildcardTemplate) replaces the literal
    // lowercase ":path*" only — a miscased token in a WILDCARD
    // destination never substitutes and leaks verbatim into the
    // Location header: the same leak class the exact-branch
    // literal-token check rejects (SU5-A3), which only covered EXACT
    // entries.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wildcardEntries } = buildRedirectLookup([
      { id: "upper-dest", source: "/x/:path*", destination: "/a/:PATH*" },
      // Mixed case leaks too: the lowercase token substitutes but the
      // miscased one survives.
      {
        id: "mixed-dest",
        source: "/y/:path*",
        destination: "/a/:path*/b/:Path*",
      },
      { id: "ok", source: "/z/:path*", destination: "/b/:path*" },
    ]);
    expect(wildcardEntries).toHaveLength(1);
    expect(wildcardEntries[0].id).toBe("ok");
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("miscased"),
    );
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain("upper-dest");
    expect(String(warns[0][0])).toContain("mixed-dest");
    expect(String(warns[0][0])).not.toContain("(ok)");
  });

  it("warns (without skipping) when a wildcard destination has NO :path* token (SU6-A2)", () => {
    // A tokenless wildcard destination silently DROPS the matched
    // remainder — every subpath collapses onto one page. That is
    // sometimes deliberate (see the allowlist test below) and sometimes
    // a forgotten token, so the builder warns but KEEPS the entry: the
    // collapse is well-defined behavior either way.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wildcardEntries } = buildRedirectLookup([
      { id: "typo-collapse", source: "/x/:path*", destination: "/a" },
      { id: "kept-ok", source: "/y/:path*", destination: "/b/:path*" },
    ]);
    expect(wildcardEntries).toHaveLength(2);
    expect(wildcardEntries.map((wc) => wc.id)).toEqual([
      "typo-collapse",
      "kept-ok",
    ]);
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes('no ":path*" token'),
    );
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain("typo-collapse");
    expect(String(warns[0][0])).not.toContain("kept-ok");
  });

  it("classifies a discarded same-destination tokenless wildcard twin as a silent duplicate — ZERO tokenless warns (SU7-F3)", () => {
    // The duplicate-prefix owner check used to run AFTER the
    // miscased/tokenless destination checks, so an entry that was about
    // to be DISCARDED as a duplicate still fired destination warns —
    // misclassifying a harmless same-destination twin as a tokenless
    // table bug and desensitizing that channel (the exact failure mode
    // the SU5-A3 twin allowlist exists to prevent).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wildcardEntries } = buildRedirectLookup([
      // Allowlisted deliberate collapse — silent by design (SU6-A2).
      {
        id: "P10",
        source: "/reference/v1/:path*",
        destination: "/reference/v2",
      },
      // Same-destination twin whose id is NOT allowlisted: it must be
      // skipped silently as a duplicate, never reaching the tokenless
      // check.
      {
        id: "P10-twin",
        source: "/reference/v1/:path*",
        destination: "/reference/v2",
      },
    ]);
    expect(wildcardEntries).toHaveLength(1);
    expect(wildcardEntries[0].id).toBe("P10");
    const tokenlessWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes('no ":path*" token'),
    );
    expect(tokenlessWarns).toHaveLength(0);
    const dupWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("duplicate"),
    );
    expect(dupWarns).toHaveLength(0);
  });

  it("classifies a miscased-destination duplicate as a DUPLICATE, not a miscased-token bug (SU7-F3)", () => {
    // A diverging duplicate is discarded whatever its destination looks
    // like — it must warn on the duplicate channel (naming the shadowing
    // owner), not on the miscased-token channel.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wildcardEntries } = buildRedirectLookup([
      { id: "owner", source: "/x/:path*", destination: "/a/:path*" },
      { id: "twin", source: "/x/:path*", destination: "/a/:PATH*" },
    ]);
    expect(wildcardEntries).toHaveLength(1);
    expect(wildcardEntries[0].id).toBe("owner");
    const miscasedWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("miscased"),
    );
    expect(miscasedWarns).toHaveLength(0);
    const dupWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("duplicate wildcard"),
    );
    expect(dupWarns).toHaveLength(1);
    expect(String(dupWarns[0][0])).toContain("twin");
    expect(String(dupWarns[0][0])).toContain("owner");
  });

  it("stays silent for the documented deliberate-collapse wildcard entries (SU6-A2)", () => {
    // P10 (all of /reference/v1/* onto the v2 reference root) and the
    // S13w×<fw> family (each framework's removed concepts/* section
    // onto the framework root) collapse ON PURPOSE — warning on them
    // at every cold start would desensitize the table-bug channel,
    // exactly like the duplicate twins before the SU5-A3 allowlist.
    expect(DELIBERATE_COLLAPSE_WILDCARD_IDS.test("P10")).toBe(true);
    expect(DELIBERATE_COLLAPSE_WILDCARD_IDS.test("S13w×mastra")).toBe(true);
    // No accidental prefix over-matching: P10× variants are NOT P10.
    expect(DELIBERATE_COLLAPSE_WILDCARD_IDS.test("P10×other")).toBe(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildRedirectLookup([
      {
        id: "P10",
        source: "/reference/v1/:path*",
        destination: "/reference/v2",
      },
      {
        id: "S13w×mastra",
        source: "/mastra/concepts/:path*",
        destination: "/mastra",
      },
    ]);
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes('no ":path*" token'),
    );
    expect(warns).toHaveLength(0);
  });

  it("compares exact-under-wildcard destinations with the ORIGINAL-case remainder (SU5-A3)", () => {
    // The divergence check sliced the remainder from the LOWERCASED key,
    // so an exact entry whose destination preserves the source's
    // original case (exactly what the wildcard produces at request time
    // — middleware slices the rest from the original-case path) was a
    // false-positive "DIFFERENT destination" warn, and the diagnostic
    // printed a wildcardDestination the author never wrote.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildRedirectLookup([
      { id: "wild", source: "/x/:path*", destination: "/a/:path*" },
      { id: "exact-case", source: "/x/Page", destination: "/a/Page" },
    ]);
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("exact beats"),
    );
    expect(warns).toHaveLength(0);
  });

  it("normalizes twin-allowlist comparisons like request time — a trailing slash is not a divergence (SU6-A3)", () => {
    // "/y/" and "/y" resolve to the SAME URL at request time
    // (resolveSeoDestination runs every destination through
    // normalizeRedirectPath) — the raw-string compare wrongly flagged
    // such twins as different-destination duplicates, a false-positive
    // warn on the channel the SU5-A3 allowlist exists to keep quiet.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exactMap, wildcardEntries } = buildRedirectLookup([
      { id: "first", source: "/x", destination: "/y" },
      { id: "second", source: "/x", destination: "/y/" },
      { id: "w-first", source: "/w/:path*", destination: "/y/:path*" },
      { id: "w-second", source: "/w/:path*", destination: "/y/:path*/" },
    ]);
    expect(exactMap.get("/x")?.id).toBe("first");
    expect(wildcardEntries).toHaveLength(1);
    expect(wildcardEntries[0].id).toBe("w-first");
    const dupWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("duplicate"),
    );
    expect(dupWarns).toHaveLength(0);
  });

  it("warns when an exact source under an earlier wildcard has a DIFFERENT destination (SU4-A2)", () => {
    // Exact beats wildcard regardless of table order — a top-to-bottom
    // reading of the table says otherwise, so flag the divergence.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildRedirectLookup([
      { id: "wild", source: "/x/:path*", destination: "/a/:path*" },
      { id: "diverges", source: "/x/page", destination: "/elsewhere" },
      // Same destination (modulo the trailing slash a zero-segment
      // substitution leaves) is harmless — stays silent.
      { id: "agrees", source: "/x/other", destination: "/a/other" },
    ]);
    const warns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("exact beats"),
    );
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain("diverges");
    expect(String(warns[0][0])).toContain("wild");
    expect(String(warns[0][0])).not.toContain("agrees");
  });

  it("substitutes EVERY :path* token in a destination template", () => {
    // Single .replace() left the 2nd+ tokens as literal ":path*" in the
    // Location header. Function replacer keeps user-controlled rest
    // ($&, $', $`) literal — and replaceAll never rescans inserted text,
    // so a rest of ":path*" cannot loop or double-substitute.
    expect(substituteWildcardTemplate("/a/:path*/b/:path*", "z")).toBe(
      "/a/z/b/z",
    );
    expect(substituteWildcardTemplate("/a/:path*", "$&x")).toBe("/a/$&x");
    expect(substituteWildcardTemplate("/a/:path*", ":path*")).toBe("/a/:path*");
    expect(substituteWildcardTemplate("/fixed", "anything")).toBe("/fixed");
  });
});

describe("wildcard substitution is replacement-pattern safe (SU2-A1)", () => {
  it("does not expand $-patterns from the user-controlled path remainder", () => {
    // String-form String.prototype.replace treats `$&`, "$`", `$'`, `$$`
    // in the REPLACEMENT as special patterns: `$&` re-inserts the matched
    // substring, leaking the literal ":path*" token into the Location.
    const res = run("/coagents/$&foo");
    const dest = location(res);
    expect(dest.pathname).not.toContain(":path*");
    expect(dest.pathname).toBe("/langgraph-python/$&foo");
  });

  it("keeps literal $$ and $` sequences intact", () => {
    // $$ is the live sub-case: it reaches the replacer verbatim and the
    // string form of .replace() would collapse it to a single "$".
    expect(location(run("/coagents/$$bar")).pathname).toBe(
      "/langgraph-python/$$bar",
    );
    // The backtick is percent-encoded by URL parsing BEFORE the
    // replacer ever sees it ("$%60baz"), so this sub-case can't
    // exercise $`-expansion — it pins the encoding passthrough instead.
    expect(location(run("/coagents/$`baz")).pathname).toBe(
      "/langgraph-python/$%60baz",
    );
  });
});

describe("capture payload disambiguates the destination host (SU2-A5)", () => {
  it("emits to_url with the docs host alongside to_path", async () => {
    // Self-referential docs-host entries (e.g. M3 /faq -> /faq) used to
    // emit from_path === to_path, which is ambiguous for the
    // decommission report — the destination actually lives on the DOCS
    // host, not the shell.
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", fetchMock);
    run("/faq?utm_source=x");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.properties.from_path).toBe("/faq");
    expect(body.properties.to_path).toBe("/faq");
    // Host included; query string excluded (it varies per request and
    // would explode property cardinality).
    expect(body.properties.to_url).toBe(`${DOCS_HOST}/faq`);
  });
});

describe("PostHog capture failures are observable (SU2-A2)", () => {
  // The decommission report deletes redirects that show zero PostHog
  // traffic — silently-broken capture (swallowed rejections, unchecked
  // 4xx/5xx) causes wrongful deletions. Each failure class must warn
  // once (not per request).
  //
  // The warn-once latch (captureFailureWarnings) is module-level: on
  // the statically-imported instance these tests only pass while no
  // earlier test — or a retry of THIS test — has tripped the same
  // failure class. Fresh-import per test (the SU-14 pattern) so each
  // test owns the latch and stays retry/order-safe.
  let freshMiddleware: typeof middleware;

  beforeEach(async () => {
    vi.resetModules();
    ({ middleware: freshMiddleware } = await import("./middleware"));
    // Clear the module-load warns the fresh import re-emitted so the
    // class-filtered counts below start from zero.
    vi.mocked(console.warn).mockClear();
  });

  function runFresh(pathAndQuery: string, event: NextFetchEvent) {
    return freshMiddleware(
      new NextRequest(`${SHELL_ORIGIN}${pathAndQuery}`),
      event,
    );
  }

  async function flushCapture(event: NextFetchEvent): Promise<void> {
    const waitUntil = event.waitUntil as ReturnType<typeof vi.fn>;
    await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
  }

  it("warns once per HTTP-status failure class when capture returns non-2xx", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("err", { status: 500 }))),
    );
    const event = makeEvent();
    runFresh("/faq", event);
    runFresh("/quickstart", event);
    await flushCapture(event);
    const captureWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("http:500"),
    );
    expect(captureWarns).toHaveLength(1);
  });

  it("warns once per network failure class when capture rejects", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    const event = makeEvent();
    runFresh("/faq", event);
    runFresh("/quickstart", event);
    await flushCapture(event);
    const captureWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("net:TypeError"),
    );
    expect(captureWarns).toHaveLength(1);
  });
});

describe("normalizePosthogHost — use-site guard (SU2-A6/SU4-A7)", () => {
  // The scheme-less branch is UNREACHABLE through middleware():
  // runtime-config's ensureScheme normalizes POSTHOG_HOST before the
  // value is threaded in, so only direct unit tests can exercise the
  // guard itself (the describe below pins the through-middleware
  // behavior).
  it("prepends https:// to a raw scheme-less host", () => {
    expect(normalizePosthogHost("eu.posthog.example.test")).toBe(
      "https://eu.posthog.example.test",
    );
  });

  it("leaves an explicit scheme untouched", () => {
    expect(normalizePosthogHost("http://localhost:8000")).toBe(
      "http://localhost:8000",
    );
    expect(normalizePosthogHost("https://eu.posthog.com")).toBe(
      "https://eu.posthog.com",
    );
  });

  it("strips trailing slashes so the /capture/ concatenation never yields '//' (SU7-F3)", () => {
    // The guard exists to keep `${host}/capture/` well-formed for ANY
    // raw value a future caller hands it — completing that contract
    // means a trailing-slash host must not produce "host//capture/".
    expect(normalizePosthogHost("https://eu.posthog.example.test/")).toBe(
      "https://eu.posthog.example.test",
    );
    expect(normalizePosthogHost("eu.posthog.example.test//")).toBe(
      "https://eu.posthog.example.test",
    );
  });
});

describe("scheme-less POSTHOG_HOST yields an absolute capture URL — normalized upstream in runtime-config (SU2-A6)", () => {
  it("prepends https:// so the capture fetch URL is absolute", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    vi.stubEnv("POSTHOG_HOST", "eu.posthog.example.test");
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", fetchMock);
    run("/faq");
    expect(fetchMock).toHaveBeenCalledOnce();
    // A scheme-less host yields a relative URL, which fetch() rejects on
    // every capture in the Edge runtime.
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://eu.posthog.example.test/capture/",
    );
  });

  it("leaves an explicit scheme untouched", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    vi.stubEnv("POSTHOG_HOST", "http://localhost:8000");
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", fetchMock);
    run("/faq");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/capture/");
  });
});

describe("open redirect via duplicate slashes (SU-18)", () => {
  it("does NOT redirect /shared//evil.com off-site via a scheme-relative URL", () => {
    const res = run("/shared//evil.com");
    const dest = location(res);
    // Reproduced pre-fix: R26 /shared/:path* -> /:path* yields
    // "//evil.com", which `new URL()` treats as scheme-relative —
    // Location landed on https://evil.com/. Duplicate-slash collapsing
    // in resolveSeoDestination keeps the redirect on a host we own.
    expect(dest.host).not.toContain("evil.com");
    expect(dest.origin).toBe(DOCS_HOST);
    expect(dest.pathname).toBe("/evil.com");
  });
});
