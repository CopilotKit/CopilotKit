import { describe, expect, it } from "vitest";

import {
  canonicalDemoPath,
  legacyDemoRedirect,
  resolveShowcaseCell,
} from "./frontend-route";

describe("frontend-aware Showcase routes", () => {
  it("keeps frontend, backend, and feature identity in canonical links", () => {
    expect(
      canonicalDemoPath("angular", "langgraph-python", "agentic-chat"),
    ).toBe("/angular/langgraph-python/agentic-chat");
    expect(canonicalDemoPath("react", "langgraph-typescript", "mcp-apps")).toBe(
      "/react/langgraph-typescript/mcp-apps",
    );
  });

  it("redirects legacy links to React without losing backend or feature context", () => {
    expect(
      legacyDemoRedirect("langgraph-python", "agentic-chat", "preview"),
    ).toBe("/react/langgraph-python/agentic-chat/preview");
    expect(legacyDemoRedirect("langgraph-python", "agentic-chat", "code")).toBe(
      "/react/langgraph-python/agentic-chat/code",
    );
  });

  it("resolves a runnable React cell to its existing backend demo", () => {
    expect(
      resolveShowcaseCell({
        frontend: "react",
        integration: "langgraph-python",
        feature: "agentic-chat",
        backendHostPattern: "showcase-{slug}.example.test",
      }),
    ).toMatchObject({
      kind: "runnable",
      cellId: "react/langgraph-python/agentic-chat",
      iframeUrl:
        "https://showcase-langgraph-python.example.test/demos/agentic-chat",
    });
  });

  it("resolves an enabled Angular cell only through the canonical host", () => {
    expect(
      resolveShowcaseCell({
        frontend: "angular",
        integration: "langgraph-python",
        feature: "agentic-chat",
        backendHostPattern: "showcase-{slug}.example.test",
        angularHostUrl: "https://angular.staging.example.test/",
      }),
    ).toMatchObject({
      kind: "runnable",
      cellId: "angular/langgraph-python/agentic-chat",
      iframeUrl:
        "https://angular.staging.example.test/langgraph-python/agentic-chat",
    });
  });

  it("fails closed when Angular is not activated in the environment", () => {
    expect(
      resolveShowcaseCell({
        frontend: "angular",
        integration: "langgraph-python",
        feature: "agentic-chat",
        backendHostPattern: "showcase-{slug}.example.test",
      }),
    ).toMatchObject({
      kind: "unavailable",
      cellId: "angular/langgraph-python/agentic-chat",
      reason: expect.stringMatching(/not enabled/i),
    });
  });

  it("makes unsupported, backend-unavailable, and malformed cells explicit", () => {
    expect(
      resolveShowcaseCell({
        frontend: "angular",
        integration: "langgraph-python",
        feature: "declarative-json-render",
        backendHostPattern: "showcase-{slug}.example.test",
        angularHostUrl: "https://angular.staging.example.test",
      }),
    ).toMatchObject({ kind: "not-applicable" });

    expect(
      resolveShowcaseCell({
        frontend: "angular",
        integration: "crewai-crews",
        feature: "mcp-apps",
        backendHostPattern: "showcase-{slug}.example.test",
        angularHostUrl: "https://angular.staging.example.test",
      }),
    ).toMatchObject({ kind: "backend-unavailable" });

    expect(
      resolveShowcaseCell({
        frontend: "angular",
        integration: "not-a-real-backend",
        feature: "agentic-chat",
        backendHostPattern: "showcase-{slug}.example.test",
        angularHostUrl: "https://angular.staging.example.test",
      }),
    ).toEqual({
      kind: "malformed",
      reason: 'Unknown Showcase integration "not-a-real-backend".',
    });
  });
});
