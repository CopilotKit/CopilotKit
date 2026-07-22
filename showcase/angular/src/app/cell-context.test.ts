import { describe, expect, it } from "vitest";

import {
  isDefaultToolRenderingCell,
  isRunnableBrowserCell,
  readAngularRuntimeConfig,
  resolveBrowserCell,
  runtimePathForFeature,
} from "./cell-context";

const runtimeConfig = {
  frontendId: "angular" as const,
  integrationId: "langgraph-python",
};

const catalog = {
  cells: [
    {
      id: "angular/langgraph-python/agentic-chat",
      frontend: "angular",
      integration: "langgraph-python",
      feature: "agentic-chat",
      frontend_status: "supported",
      backend_status: "wired",
      runnable: true,
      exception: null,
    },
    {
      id: "angular/langgraph-python/declarative-json-render",
      frontend: "angular",
      integration: "langgraph-python",
      feature: "declarative-json-render",
      frontend_status: "not-applicable",
      backend_status: "wired",
      runnable: false,
      exception: {
        reason: "JSON Renderer is React-specific.",
        owner: "Angular SDK maintainers",
        review_date: "2027-01-21",
      },
    },
  ],
};

describe("Angular host browser cell context", () => {
  it("resolves a runnable cell to a relative same-origin runtime URL", () => {
    expect(
      resolveBrowserCell("/angular/agentic-chat", catalog, runtimeConfig),
    ).toEqual({
      kind: "runnable",
      cellId: "angular/langgraph-python/agentic-chat",
      integration: "langgraph-python",
      feature: "agentic-chat",
      runtimeUrl: "/api/copilotkit",
    });
  });

  it("keeps non-runnable cells visible with exception metadata", () => {
    expect(
      resolveBrowserCell(
        "/angular/declarative-json-render",
        catalog,
        runtimeConfig,
      ),
    ).toMatchObject({
      kind: "unavailable",
      cellId: "angular/langgraph-python/declarative-json-render",
      reason: "JSON Renderer is React-specific.",
    });
  });

  it("allows feature routes only for runnable backend intersections", () => {
    expect(
      isRunnableBrowserCell("langgraph-python", "agentic-chat", catalog),
    ).toBe(true);
    expect(
      isRunnableBrowserCell(
        "langgraph-python",
        "declarative-json-render",
        catalog,
      ),
    ).toBe(false);
    expect(isRunnableBrowserCell("unknown", "agentic-chat", catalog)).toBe(
      false,
    );
  });

  it("rejects malformed, encoded, and extra-segment routes", () => {
    for (const path of [
      "/",
      "/angular",
      "/angular/agentic-chat/extra",
      "/angular/%61gentic-chat",
      "/https://attacker.example",
    ]) {
      expect(
        resolveBrowserCell(path, catalog, runtimeConfig),
        path,
      ).toMatchObject({ kind: "malformed" });
    }
  });

  it("fails closed when the integration manifest is missing", () => {
    expect(resolveBrowserCell("/angular/agentic-chat", catalog)).toEqual({
      kind: "malformed",
      reason: "The integration runtime manifest is missing or invalid.",
    });
  });

  it("accepts only a bounded Angular integration manifest", () => {
    const globalWithManifest = globalThis as typeof globalThis & {
      __COPILOTKIT_SHOWCASE__?: unknown;
    };
    globalWithManifest.__COPILOTKIT_SHOWCASE__ = runtimeConfig;
    expect(readAngularRuntimeConfig()).toEqual(runtimeConfig);
    globalWithManifest.__COPILOTKIT_SHOWCASE__ = {
      frontendId: "angular",
      integrationId: "https://attacker.example",
      backendUrl: "https://attacker.example",
    };
    expect(readAngularRuntimeConfig()).toBeUndefined();
    delete globalWithManifest.__COPILOTKIT_SHOWCASE__;
  });

  it("uses only existing relative same-origin runtime routes", () => {
    expect(runtimePathForFeature("agentic-chat")).toBe("/api/copilotkit");
    expect(runtimePathForFeature("a2ui-recovery")).toBe(
      "/api/copilotkit-a2ui-recovery",
    );
    expect(runtimePathForFeature("open-gen-ui")).toBe("/api/copilotkit-ogui");
  });

  it("opts into the built-in wildcard renderer only for its dedicated cell", () => {
    expect(isDefaultToolRenderingCell("tool-rendering-default-catchall")).toBe(
      true,
    );
    expect(isDefaultToolRenderingCell("tool-rendering")).toBe(false);
  });
});
