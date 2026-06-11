import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { NextFetchEvent } from "next/server";
import { config, middleware, warnIfNoFrameworkSlugs } from "./middleware";

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
  // The matcher is a path-to-regexp pattern of the shape "/(<regex>.*)";
  // anchoring it as a plain RegExp reproduces Next's matching for it.
  const matcherRe = new RegExp(`^${config.matcher[0]}$`);

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
  it("registers the tracking fetch with event.waitUntil", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
    vi.stubGlobal("fetch", fetchMock);
    const event = makeEvent();
    run("/faq", event);
    expect(fetchMock).toHaveBeenCalledOnce();
    // Without waitUntil the Edge runtime may terminate right after the
    // redirect response, dropping the in-flight capture.
    expect(event.waitUntil).toHaveBeenCalledOnce();
  });

  it("does not call waitUntil when tracking is disabled (no POSTHOG_KEY)", () => {
    vi.stubEnv("POSTHOG_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
    vi.stubGlobal("fetch", fetchMock);
    const event = makeEvent();
    run("/faq", event);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(event.waitUntil).not.toHaveBeenCalled();
    warn.mockRestore();
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
