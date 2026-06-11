import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { NextRequest } from "next/server";
import type { NextFetchEvent } from "next/server";
import {
  buildRedirectLookup,
  config,
  middleware,
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
  // With tracking forced off, the first redirect test trips the
  // statically-imported module's warn-once latch — spy at file level so
  // no real console.warn escapes (restoreAllMocks in afterEach resets it).
  vi.spyOn(console, "warn").mockImplementation(() => {});
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
    // /docs/api is ALSO an SEO source (R2 -> /reference/v2); step 0 must
    // win and strip the /docs prefix instead, like config redirects did.
    const res = run("/docs/api");
    expect(res.status).toBe(308);
    expect(location(res).pathname).toBe("/api");

    // A registry framework slug is step-0 territory even when the SEO
    // table has wildcard entries that could match it.
    const slugRes = run("/mastra/quickstart/mastra");
    expect(slugRes.status).toBe(308);
    expect(location(slugRes).pathname).toBe("/mastra/quickstart/mastra");
  });

  it("does not redirect shell-owned routes", () => {
    const res = run("/integrations/mastra");
    expect(res.headers.get("location")).toBeNull();
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
  // Compile the matcher with Next's own vendored path-to-regexp and the
  // option set Next uses for middleware matchers — a homemade anchored
  // RegExp only happens to work for this pattern shape and would
  // diverge from Next on any path-to-regexp syntax in the matcher.
  const matcherRe = pathToRegexp(config.matcher[0], [], {
    delimiter: "/",
    sensitive: false,
    strict: true,
  });

  it("runs middleware on /api and /api-reference (SEO sources R1/R3)", () => {
    expect(matcherRe.test("/api")).toBe(true);
    expect(matcherRe.test("/api-reference")).toBe(true);
  });

  it("still excludes real API routes and internals", () => {
    expect(matcherRe.test("/api/runtime")).toBe(false);
    expect(matcherRe.test("/_next/static/chunk.js")).toBe(false);
    expect(matcherRe.test("/previews/foo")).toBe(false);
    expect(matcherRe.test("/favicon.ico")).toBe(false);
  });

  it("redirects /api and /api-reference to /reference/v2 on the docs host", () => {
    const apiDest = location(run("/api"));
    expect(apiDest.origin).toBe(DOCS_HOST);
    expect(apiDest.pathname).toBe("/reference/v2");
    const apiRefDest = location(run("/api-reference"));
    expect(apiRefDest.pathname).toBe("/reference/v2");
  });
});

describe("empty framework-slug set guard (SU-20)", () => {
  it("console.errors in production when the slug set is empty", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    warnIfNoFrameworkSlugs(new Set());
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain("ZERO framework slugs");
  });

  it("console.warns outside production when the slug set is empty", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfNoFrameworkSlugs(new Set());
    expect(warn).toHaveBeenCalledOnce();
  });

  it("stays silent when slugs are present", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfNoFrameworkSlugs(new Set(["mastra"]));
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
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
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("POSTHOG_KEY");
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
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("/x:path*");
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
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("/dup");
    expect(warn.mock.calls[0][0]).toContain("second");
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
    expect(location(run("/coagents/$$bar")).pathname).toBe(
      "/langgraph-python/$$bar",
    );
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
    run("/faq", event);
    run("/quickstart", event);
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
    run("/faq", event);
    run("/quickstart", event);
    await flushCapture(event);
    const captureWarns = warn.mock.calls.filter(([msg]) =>
      String(msg).includes("net:TypeError"),
    );
    expect(captureWarns).toHaveLength(1);
  });
});

describe("scheme-less POSTHOG_HOST is normalized at the use site (SU2-A6)", () => {
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
