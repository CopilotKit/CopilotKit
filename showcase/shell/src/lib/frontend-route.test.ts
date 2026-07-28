import { describe, expect, it } from "vitest";

import {
  canonicalDemoPath,
  legacyDemoRedirect,
  resolveShowcaseCell,
} from "./frontend-route";

describe("frontend-aware Showcase routes", () => {
  it("keeps frontend, integration, and feature identity in canonical links", () => {
    expect(
      canonicalDemoPath("angular", "langgraph-python", "agentic-chat"),
    ).toBe("/angular/langgraph-python/agentic-chat");
    expect(canonicalDemoPath("react", "mastra", "mcp-apps")).toBe(
      "/react/mastra/mcp-apps",
    );
  });

  it("redirects legacy links to React without losing the selected view", () => {
    expect(
      legacyDemoRedirect("langgraph-python", "agentic-chat", "preview"),
    ).toBe("/react/langgraph-python/agentic-chat/preview");
    expect(legacyDemoRedirect("langgraph-python", "agentic-chat", "code")).toBe(
      "/react/langgraph-python/agentic-chat/code",
    );
  });

  it("keeps React on the existing demo route", () => {
    expect(
      resolveShowcaseCell({
        frontend: "react",
        integration: "langgraph-python",
        feature: "agentic-chat",
        backendHostPattern: "showcase-{slug}.example.test",
      }),
    ).toMatchObject({
      kind: "runnable",
      iframeUrl:
        "https://showcase-langgraph-python.example.test/demos/agentic-chat",
    });
  });

  it("serves Angular from the same existing integration image", () => {
    expect(
      resolveShowcaseCell({
        frontend: "angular",
        integration: "langgraph-python",
        feature: "agentic-chat",
        backendHostPattern: "showcase-{slug}.example.test",
      }),
    ).toMatchObject({
      kind: "runnable",
      iframeUrl:
        "https://showcase-langgraph-python.example.test/angular/agentic-chat",
    });
  });

  it("shows declared exclusions and unavailable backend fixtures", () => {
    expect(
      resolveShowcaseCell({
        frontend: "angular",
        integration: "langgraph-python",
        feature: "declarative-json-render",
        backendHostPattern: "showcase-{slug}.example.test",
      }),
    ).toMatchObject({ kind: "not-applicable" });

    expect(
      resolveShowcaseCell({
        frontend: "angular",
        integration: "crewai-crews",
        feature: "mcp-apps",
        backendHostPattern: "showcase-{slug}.example.test",
      }),
    ).toMatchObject({ kind: "backend-unavailable" });
  });
});
