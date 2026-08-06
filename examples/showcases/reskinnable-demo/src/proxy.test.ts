import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

/**
 * The rewrite destination Next encodes on the response. `NextResponse.rewrite`
 * does not change the status or body — it sets this internal header, which the
 * server reads to pick the route to render — so this is the only observable
 * output of a rewrite and the only thing worth asserting.
 */
function rewriteTargetFor(pathname: string): string | null {
  const res = proxy(new NextRequest(`http://localhost:3000${pathname}`));
  const target = res?.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

describe("proxy — unlocked", () => {
  // The whole compatibility claim: with LOCK_SKIN unset this hook must be inert,
  // so the four-skin demo routes exactly as it did before the proxy existed.
  it("rewrites nothing", () => {
    vi.stubEnv("LOCK_SKIN", "");
    for (const path of ["/", "/banking", "/banking/cards", "/keel/runs/r-1"]) {
      expect(rewriteTargetFor(path)).toBeNull();
    }
  });
});

describe("proxy — locked", () => {
  it("serves the locked skin AT the root", () => {
    // The defect this exists to fix: `/` used to REDIRECT to /banking, putting
    // the substrate's tenant id in front of a customer on the front door.
    vi.stubEnv("LOCK_SKIN", "banking");
    expect(rewriteTargetFor("/")).toBe("/banking");
  });

  it("maps every inner route onto the skin's segment", () => {
    vi.stubEnv("LOCK_SKIN", "banking");
    expect(rewriteTargetFor("/cards")).toBe("/banking/cards");
    expect(rewriteTargetFor("/dashboard")).toBe("/banking/dashboard");
    expect(rewriteTargetFor("/team")).toBe("/banking/team");
  });

  it("preserves parameterized depth", () => {
    vi.stubEnv("LOCK_SKIN", "keel");
    expect(rewriteTargetFor("/runs/r-1")).toBe("/keel/runs/r-1");
    expect(rewriteTargetFor("/knowledge/phi-access-policy")).toBe(
      "/keel/knowledge/phi-access-policy",
    );
  });

  it("sends a stale prefixed bookmark somewhere that 404s", () => {
    // Under a lock the tenant path is as absent as /nope. /banking/banking has
    // no page, so resolvePage returns null and the route 404s — deliberately the
    // same answer the other three skins give.
    vi.stubEnv("LOCK_SKIN", "banking");
    expect(rewriteTargetFor("/banking")).toBe("/banking/banking");
  });

  it("still routes a disowned skin's segment into the locked skin", () => {
    vi.stubEnv("LOCK_SKIN", "banking");
    expect(rewriteTargetFor("/airline")).toBe("/banking/airline");
  });

  it("throws on a typo rather than routing the deploy into a 404", () => {
    vi.stubEnv("LOCK_SKIN", "bankng");
    expect(() => rewriteTargetFor("/")).toThrow(/bankng/);
  });

  it("carries the query string through", () => {
    vi.stubEnv("LOCK_SKIN", "banking");
    const res = proxy(
      new NextRequest("http://localhost:3000/charges?tab=pending"),
    );
    const target = new URL(res!.headers.get("x-middleware-rewrite")!);
    expect(target.pathname).toBe("/banking/charges");
    expect(target.search).toBe("?tab=pending");
  });
});

describe("proxy matcher", () => {
  const matcher = config.matcher[0];
  const matches = (path: string) => new RegExp(`^${matcher}$`).test(path);

  // THE safety property. If this ever matches, the runtime's SSE stream gets
  // rewritten to /banking/api/copilotkit and every agent run in the app dies.
  it("never matches the runtime or REST endpoints", () => {
    expect(matches("/api/copilotkit")).toBe(false);
    expect(matches("/api/copilotkit/info")).toBe(false);
    expect(matches("/api/banking/v1/cards")).toBe(false);
    expect(matches("/api/logistics/v1/shipments")).toBe(false);
  });

  it("never matches Next's own asset routes or public files", () => {
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/_next/image")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    // Banking's demo attachment is served from public/ and must stay reachable:
    // the Q2-invoice beat loads it as a real PDF.
    expect(matches("/sample-invoice-q2.pdf")).toBe(false);
  });

  it("matches the pages a lock has to rewrite", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/cards")).toBe(true);
    expect(matches("/keel/runs/r-1")).toBe(true);
    expect(matches("/knowledge/phi-access-policy")).toBe(true);
  });
});
