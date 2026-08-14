import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  effectivePathnameHeader,
  middlewareRuns,
} from "@/lib/test-helpers/middleware-matcher";

import { config, middleware, PATHNAME_HEADER } from "./middleware";

/**
 * `src/app/[integration]/demos/layout.tsx` cannot see the demo segment
 * without the `x-pathname` header this middleware sets, so these assertions
 * are load-bearing for the support guard, not cosmetic.
 */
describe("middleware", () => {
  it("copies the request pathname into x-pathname", () => {
    const response = middleware(
      new NextRequest("http://localhost:3000/spring-ai/demos/mcp-apps"),
    );
    expect(response.headers.get("x-middleware-override-headers")).toContain(
      "x-pathname",
    );
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe(
      "/spring-ai/demos/mcp-apps",
    );
  });

  it("does not include the query string", () => {
    const response = middleware(
      new NextRequest("http://localhost:3000/agno/demos/hitl?turn=2"),
    );
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe(
      "/agno/demos/hitl",
    );
  });

  it("overwrites a client-supplied x-pathname with the real path", () => {
    // THE load-bearing security property. `new Headers(request.headers)`
    // followed by `.set()` (not `.append()`) is what stops a client from
    // naming a different, supported demo and skipping the layout guard.
    const response = middleware(
      new NextRequest(
        "http://localhost:3000/spring-ai/demos/gen-ui-interrupt",
        {
          headers: {
            [PATHNAME_HEADER]: "/langgraph-python/demos/agentic-chat",
          },
        },
      ),
    );
    expect(
      response.headers.get(`x-middleware-request-${PATHNAME_HEADER}`),
    ).toBe("/spring-ai/demos/gen-ui-interrupt");
  });

  it("matches demo routes and skips static assets", () => {
    expect(middlewareRuns("/spring-ai/demos/mcp-apps")).toBe(true);
    expect(middlewareRuns("/langgraph-python/demos/agentic-chat")).toBe(true);
    expect(middlewareRuns("/_next/static/chunk.js")).toBe(false);
    expect(middlewareRuns("/favicon.ico")).toBe(false);
  });

  it.each([
    "/spring-ai/demos/mcp.apps",
    "/spring-ai/demos/gen-ui-interrupt.x",
    "/spring-ai/demos",
    "/spring-ai/demos/",
    "/some.slug/demos/agentic-chat",
  ])("runs on the demo path %s even though it contains a dot", (pathname) => {
    /**
     * THE CLOSED BYPASS. The matcher's static-asset exclusion used to skip ANY
     * path with a dot, demo routes included. On a skipped path the middleware
     * does not run, so `x-pathname` arrives client-supplied, and the layout
     * cross-checks only its FIRST segment against `[integration]` — so a
     * header naming the same slug but a different, supported demo passed the
     * guard. `demos/layout.test.tsx` drives that spoof end to end.
     *
     * A `/<seg>/demos` path is a ROUTE, never a static asset, so the dot rule
     * must not reach it.
     */
    expect(middlewareRuns(pathname)).toBe(true);
  });

  it.each([
    "/favicon.ico",
    "/robots.txt",
    "/copilotkit-logo.svg",
    "/demo-files/sample.pdf",
    "/demo-audio/sample.wav",
    "/_next/static/chunk.js",
    "/_next/image",
  ])("still skips the static asset %s", (pathname) => {
    // The other half of the fix: carving demo routes out of the dot rule must
    // not broaden the matcher onto anything else. Every dotted path under
    // `public/` is listed here by name.
    expect(middlewareRuns(pathname)).toBe(false);
  });

  it("overwrites a spoofed x-pathname on a dotted demo path", () => {
    // The bypass in one assertion, at the layer that closes it. Before the
    // matcher fix this returned the spoofed value untouched.
    expect(
      effectivePathnameHeader(
        "http://localhost:3000/spring-ai/demos/gen-ui-interrupt.x",
        "/spring-ai/demos/agentic-chat",
      ),
    ).toBe("/spring-ai/demos/gen-ui-interrupt.x");
  });

  it("exposes exactly one matcher, which is the one these tests read", () => {
    // `middlewareRuns` reads `config.matcher[0]`. A second entry would be
    // silently untested.
    expect(config.matcher).toHaveLength(1);
  });
});
