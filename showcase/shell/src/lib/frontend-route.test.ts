import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BACKEND_HOST_PATTERN } from "./backend-url";
// Type-only namespace import so the vi.importActual generic below does
// not need a `typeof import(...)` annotation (oxlint forbids those).
import type * as RegistryModule from "./registry";
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
        integration: "built-in-agent",
        feature: "background-agents",
        backendHostPattern: "showcase-{slug}.example.test",
      }),
    ).toMatchObject({ kind: "backend-unavailable" });
  });
});

describe("iframe URLs for a slug migrated to the unified frontend", () => {
  // The unified Next.js app serves every integration's demos at
  // <shared-origin>/<slug>/demos/<demo-id>. A migrated slug expresses
  // that with a registry `backend_url` of `https://<shared-host>/<slug>`
  // — the bare host pattern cannot. Nothing is migrated in the real
  // registry yet, so the registry module is mocked for ONE slug to prove
  // the join; the sibling describe above (which uses a NON-default
  // pattern) proves the unmigrated path is untouched.
  const SHARED = "https://showcase-frontends-production.up.railway.app";

  afterEach(() => {
    vi.doUnmock("./registry");
    vi.resetModules();
  });

  async function resolveWithMigratedRegistry(
    slug: string,
    backendUrl: string,
    frontend: string,
  ) {
    vi.resetModules();
    vi.doMock("./registry", async () => {
      const actual = await vi.importActual<typeof RegistryModule>("./registry");
      return {
        ...actual,
        getIntegration: (candidate: string) => {
          const found = actual.getIntegration(candidate);
          if (!found || candidate !== slug) return found;
          return { ...found, backend_url: backendUrl };
        },
      };
    });
    const { resolveShowcaseCell: resolveFresh } =
      await import("./frontend-route");
    return resolveFresh({
      frontend,
      integration: slug,
      feature: "agentic-chat",
      // The DEFAULT pattern is required: resolveBackendUrl only honors a
      // registry override when the shell would already resolve this slug
      // to the default production host (the staging-safety gate).
      backendHostPattern: DEFAULT_BACKEND_HOST_PATTERN,
    });
  }

  it("joins the shared host + slug path with exactly one slash", async () => {
    const cell = await resolveWithMigratedRegistry(
      "langgraph-python",
      `${SHARED}/langgraph-python`,
      "react",
    );
    expect(cell).toMatchObject({
      kind: "runnable",
      iframeUrl: `${SHARED}/langgraph-python/demos/agentic-chat`,
    });
    if (cell.kind !== "runnable") throw new Error("expected a runnable cell");
    expect(cell.iframeUrl.slice("https://".length)).not.toContain("//");
  });

  it("tolerates a trailing slash on the migrated value (host//route class)", async () => {
    const cell = await resolveWithMigratedRegistry(
      "langgraph-python",
      `${SHARED}/langgraph-python/`,
      "react",
    );
    expect(cell).toMatchObject({
      kind: "runnable",
      iframeUrl: `${SHARED}/langgraph-python/demos/agentic-chat`,
    });
  });

  it("joins the Angular route onto the migrated base with one slash", async () => {
    const cell = await resolveWithMigratedRegistry(
      "langgraph-python",
      `${SHARED}/langgraph-python`,
      "angular",
    );
    expect(cell).toMatchObject({
      kind: "runnable",
      iframeUrl: `${SHARED}/langgraph-python/angular/agentic-chat`,
    });
  });

  it("leaves an unmigrated slug on its per-slug host", async () => {
    // Same mock harness, but the value is the synthesized default — the
    // no-new-information gate must ignore it.
    const cell = await resolveWithMigratedRegistry(
      "langgraph-python",
      "https://showcase-langgraph-python-production.up.railway.app",
      "react",
    );
    expect(cell).toMatchObject({
      kind: "runnable",
      iframeUrl:
        "https://showcase-langgraph-python-production.up.railway.app/demos/agentic-chat",
    });
  });
});
