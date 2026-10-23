import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFetchEvent, NextRequest } from "next/server";
import type { middleware as middlewareHandler } from "./middleware";

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

let captured: CapturedEvent[] = [];
let pending: Promise<unknown>[] = [];
let NextRequestConstructor: typeof NextRequest;
let middleware: typeof middlewareHandler;

/** A `NextFetchEvent` stub that records the work middleware defers. */
function fetchEvent(deferred: Promise<unknown>[]): NextFetchEvent {
  return {
    waitUntil: (promise: Promise<unknown>) => {
      deferred.push(promise);
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
  const events = captured;
  const deferred = pending;
  const headers = new Headers(init.headers ?? {});
  if (init.userAgent) headers.set("user-agent", init.userAgent);
  if (init.ip) headers.set("x-forwarded-for", init.ip);

  const request = new NextRequestConstructor(
    new URL(pathname, "https://docs.copilotkit.ai"),
    {
      method: init.method ?? "GET",
      headers,
    },
  );

  const before = events.length;
  const response = middleware(request as NextRequest, fetchEvent(deferred));
  await Promise.all(deferred);
  return { response, events: events.slice(before) };
}

const CLAUDE_CODE = "claude-code/1.2.0";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

beforeEach(async () => {
  const events: CapturedEvent[] = [];
  captured = events;
  pending = [];
  vi.resetModules();
  vi.stubEnv("POSTHOG_KEY", "phc_test_key");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      events.push(JSON.parse(String(init?.body)) as CapturedEvent);
      return new Response(JSON.stringify({ status: 1 }), { status: 200 });
    }),
  );
  // Load the request fixture before the request test starts its timer.
  ({ NextRequest: NextRequestConstructor } = await import("next/server"));
  ({ middleware } = await import("./middleware"));
});

afterEach(async () => {
  try {
    await Promise.allSettled(pending);
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

describe("the agent-facing raw text surface", () => {
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

describe("telemetry must not be able to break a fetch", () => {
  it("swallows a PostHog rejection instead of rejecting into waitUntil", async () => {
    // The promise handed to `event.waitUntil` runs after the response is
    // already sent, so a rejection here cannot help the caller — it only
    // surfaces as an unhandled rejection in the Edge runtime.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      runMiddleware("/llms.txt", { userAgent: CLAUDE_CODE }),
    ).resolves.toBeDefined();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  describe("without a PostHog key", () => {
    beforeEach(async () => {
      vi.resetModules();
      vi.stubEnv("POSTHOG_KEY", "");
      ({ middleware } = await import("./middleware"));
    });

    it("stays silent when no PostHog key is configured", async () => {
      const { events } = await runMiddleware("/llms.txt", {
        userAgent: CLAUDE_CODE,
      });

      expect(events).toEqual([]);
    });
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

describe("a retired page's raw Markdown URL", () => {
  // Agents fetch `<path>.md`, not the HTML path. An exact redirect matches only
  // the path it names, so a retired page that redirects only its HTML path
  // leaves the `.md` URL an agent was told to read answering 404.
  it.each([
    ["/intelligence/connect-your-runtime", "/intelligence/quickstart"],
    ["/intelligence/connect-your-runtime.md", "/intelligence/quickstart.md"],
    ["/intelligence/connect-your-runtime.mdx", "/intelligence/quickstart.mdx"],
  ])("redirects %s to %s", async (source, destination) => {
    const { response } = await runMiddleware(source, {
      userAgent: CLAUDE_CODE,
    });

    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      destination,
    );
  });
});
