import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFetchEvent, NextRequest } from "next/server";

// The raw Markdown surface (`/llms.txt`, `/llms-full.txt`, `<path>.md`) is
// fetched by agents that never load a page, so the client PostHog snippet never
// runs for it. Middleware is the only code of ours that sees every one of those
// requests, which is why the classification lives here rather than in the route
// handlers — `llms.txt` and `llms-full.txt` both set `revalidate = false`, so
// their handler bodies do not re-run per request at all.

type CapturedEvent = {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
};

const captured: CapturedEvent[] = [];
const pending: Promise<unknown>[] = [];

/** A `NextFetchEvent` stub that records the work middleware defers. */
function fetchEvent(): NextFetchEvent {
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  } as unknown as NextFetchEvent;
}

async function runMiddleware(
  pathname: string,
  init: {
    userAgent?: string;
    ip?: string;
    method?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ response: Response; events: CapturedEvent[] }> {
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("./middleware");

  const headers = new Headers(init.headers ?? {});
  if (init.userAgent) headers.set("user-agent", init.userAgent);
  if (init.ip) headers.set("x-forwarded-for", init.ip);

  const request = new NextRequest(
    new URL(pathname, "https://docs.copilotkit.ai"),
    { method: init.method ?? "GET", headers },
  );

  const before = captured.length;
  const response = middleware(request as NextRequest, fetchEvent());
  await Promise.all(pending.splice(0));
  return { response, events: captured.slice(before) };
}

const CLAUDE_CODE = "claude-code/1.2.0";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

beforeEach(() => {
  captured.length = 0;
  pending.length = 0;
  vi.resetModules();
  vi.stubEnv("POSTHOG_KEY", "phc_test_key");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body)) as CapturedEvent);
      return new Response(JSON.stringify({ status: 1 }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the agent-facing raw text surface", () => {
  it.each([
    ["/llms.txt", "llms_index"],
    ["/llms-full.txt", "llms_full"],
    ["/learning.md", "page_markdown"],
    ["/langgraph-python/quickstart.mdx", "page_markdown"],
  ])("reports %s as surface %s", async (pathname, surface) => {
    const { events } = await runMiddleware(pathname, {
      userAgent: CLAUDE_CODE,
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("docs.llm_text_fetched");
    expect(events[0]!.properties.surface).toBe(surface);
    expect(events[0]!.properties.path).toBe(pathname);
  });

  it("names the caller, which is the whole question the hit count cannot answer", async () => {
    const { events } = await runMiddleware("/llms.txt", {
      userAgent: CLAUDE_CODE,
    });

    expect(events[0]!.properties.caller_class).toBe("coding_agent");
    expect(events[0]!.properties.caller_agent).toBe("claude_code");
    // The raw agent travels too, so a bucket that turns out wrong can be re-cut
    // over history without a redeploy.
    expect(events[0]!.properties.$raw_user_agent).toBe(CLAUDE_CODE);
  });

  it("caps a hostile user agent rather than forwarding it whole", async () => {
    const { events } = await runMiddleware("/llms.txt", {
      userAgent: "x".repeat(4000),
    });

    expect(String(events[0]!.properties.$raw_user_agent)).toHaveLength(512);
  });

  it("must never mint a person per fetch", async () => {
    // These fetches carry no cookie and no session. Person profiles would add
    // one person per caller — mostly crawlers — and distort every person count
    // in the project.
    const { events } = await runMiddleware("/learning.md", {
      userAgent: CLAUDE_CODE,
    });

    expect(events[0]!.properties.$process_person_profile).toBe(false);
    // PostHog otherwise stamps the POSTing server's own address, which would
    // read as a plausible breakdown of where agents fetch from.
    expect(events[0]!.properties.$geoip_disable).toBe(true);
  });

  it("records the deployment so preview and local traffic stay out of the count", async () => {
    // shell-docs runs on Railway, so that variable is the one that is
    // actually set in production.
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "preview");
    const { events } = await runMiddleware("/llms.txt", {
      userAgent: CLAUDE_CODE,
    });

    expect(events[0]!.properties.environment).toBe("preview");
  });

  it("falls back to the Vercel variable for a preview built elsewhere", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const { events } = await runMiddleware("/llms.txt", {
      userAgent: CLAUDE_CODE,
    });

    expect(events[0]!.properties.environment).toBe("preview");
  });

  it("gives the same caller a stable handle, so uniq() counts callers not fetches", async () => {
    // A random id per request — what the pageview path does for a cookie-less
    // caller — makes `uniq(distinct_id)` a restatement of the event count.
    const first = await runMiddleware("/llms.txt", {
      userAgent: CLAUDE_CODE,
      ip: "203.0.113.7",
    });
    const second = await runMiddleware("/llms-full.txt", {
      userAgent: CLAUDE_CODE,
      ip: "203.0.113.7",
    });
    const other = await runMiddleware("/llms.txt", {
      userAgent: "GPTBot/1.1",
      ip: "203.0.113.7",
    });

    expect(first.events[0]!.distinct_id).toBe(second.events[0]!.distinct_id);
    expect(other.events[0]!.distinct_id).not.toBe(first.events[0]!.distinct_id);
  });

  it("does not carry the caller's address, only a handle derived from it", async () => {
    const { events } = await runMiddleware("/llms.txt", {
      userAgent: CLAUDE_CODE,
      ip: "203.0.113.7",
    });

    expect(JSON.stringify(events[0]!)).not.toContain("203.0.113.7");
  });

  it("does not set the pageview cookie on a caller that will never return it", async () => {
    const { response } = await runMiddleware("/llms.txt", {
      userAgent: CLAUDE_CODE,
    });

    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("the boundary with ordinary docs pageviews", () => {
  it("still reports a real page as docs_pageview", async () => {
    const { events } = await runMiddleware("/quickstart", {
      userAgent: CHROME,
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("docs_pageview");
    expect(events[0]!.properties.path).toBe("/quickstart");
  });

  it("counts a raw text fetch exactly once, and never as a docs visitor", async () => {
    // The Kiteline funnel reads `docs_pageview` as "building something". A
    // crawler pulling 126k Markdown pages a month is not that, and counting the
    // same fetch under both events would only move the inflation.
    const { events } = await runMiddleware("/learning.md", {
      userAgent: "GPTBot/1.1",
    });

    expect(events.map((event) => event.event)).toEqual([
      "docs.llm_text_fetched",
    ]);
  });

  it("leaves the redirect table in front of the count", async () => {
    // A path that redirects is answered with a 301 and reported as
    // `seo_redirect`; the fetch is counted on the destination instead.
    const { response, events } = await runMiddleware("/(other)/learning.md", {
      userAgent: CLAUDE_CODE,
    });

    expect(response.status).toBe(301);
    expect(events.map((event) => event.event)).toEqual(["seo_redirect"]);
  });
});

describe("what is deliberately not counted", () => {
  it("ignores a HEAD probe, which agents send before fetching", async () => {
    // Counting it would double every caller that probes against those that
    // only ever GET.
    const { events } = await runMiddleware("/llms.txt", {
      method: "HEAD",
      userAgent: CLAUDE_CODE,
    });

    expect(events).toEqual([]);
  });

  it("ignores a browser prefetch of a raw Markdown URL", async () => {
    const { events } = await runMiddleware("/learning.md", {
      userAgent: CHROME,
      headers: { "sec-purpose": "prefetch" },
    });

    expect(events).toEqual([]);
  });
});
