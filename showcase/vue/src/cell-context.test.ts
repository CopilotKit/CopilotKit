import { afterEach, describe, expect, it } from "vitest";

import {
  readVueRuntimeConfig,
  resolveBrowserCell,
  runtimePathForFeature,
} from "./cell-context";
import type { BrowserCellCatalog, VueRuntimeConfig } from "./cell-context";

const runtimeConfig: VueRuntimeConfig = {
  frontendId: "vue",
  integrationId: "langgraph-python",
};

function catalogWith(
  overrides: Partial<BrowserCellCatalog["cells"][number]> = {},
): BrowserCellCatalog {
  return {
    cells: [
      {
        id: "vue/langgraph-python/agentic-chat",
        frontend: "vue",
        integration: "langgraph-python",
        feature: "agentic-chat",
        frontend_status: "supported",
        backend_status: "wired",
        runnable: true,
        exception: null,
        ...overrides,
      },
    ],
  };
}

afterEach(() => {
  delete globalThis.__COPILOTKIT_SHOWCASE__;
});

describe("Vue host browser cell context", () => {
  it("accepts only the exact bounded Vue runtime manifest", () => {
    globalThis.__COPILOTKIT_SHOWCASE__ = runtimeConfig;
    expect(readVueRuntimeConfig()).toEqual(runtimeConfig);

    for (const manifest of [
      { frontendId: "angular", integrationId: "langgraph-python" },
      { frontendId: "vue", integrationId: "https://attacker.example" },
      { ...runtimeConfig, backendUrl: "https://attacker.example" },
      { ...runtimeConfig, providerKey: "must-not-reach-the-browser" },
      null,
    ]) {
      globalThis.__COPILOTKIT_SHOWCASE__ = manifest;
      expect(readVueRuntimeConfig()).toBeUndefined();
    }
  });

  it("accepts exactly /vue/<feature> and rejects malformed route variants", () => {
    expect(
      resolveBrowserCell("/vue/agentic-chat", catalogWith(), runtimeConfig),
    ).toEqual({
      kind: "runnable",
      cellId: "vue/langgraph-python/agentic-chat",
      integration: "langgraph-python",
      feature: "agentic-chat",
      runtimeUrl: "/api/copilotkit",
    });

    for (const pathname of [
      "/",
      "/vue",
      "/vue/",
      "/vue/agentic-chat/",
      "/vue/agentic-chat/extra",
      "/vue/%61gentic-chat",
      "/angular/agentic-chat",
      "/https://attacker.example",
    ]) {
      expect(
        resolveBrowserCell(pathname, catalogWith(), runtimeConfig),
        pathname,
      ).toMatchObject({ kind: "malformed" });
    }
  });

  it("fails closed for missing and non-runnable catalog cells", () => {
    expect(
      resolveBrowserCell("/vue/agentic-chat", { cells: [] }, runtimeConfig),
    ).toEqual({
      kind: "malformed",
      reason: "The demo cell is not declared.",
    });
    expect(
      resolveBrowserCell(
        "/vue/agentic-chat",
        catalogWith({
          runnable: false,
          exception: { reason: "Vue activation is intentionally deferred." },
        }),
        runtimeConfig,
      ),
    ).toMatchObject({
      kind: "unavailable",
      reason: "Vue activation is intentionally deferred.",
    });
  });

  it("rejects unsupported intersections even if a fixture marks them runnable", () => {
    expect(
      resolveBrowserCell(
        "/vue/agentic-chat",
        catalogWith({ frontend_status: "not-supported" }),
        runtimeConfig,
      ),
    ).toMatchObject({ kind: "unavailable" });
    expect(
      resolveBrowserCell(
        "/vue/agentic-chat",
        catalogWith({ backend_status: "unshipped" }),
        runtimeConfig,
      ),
    ).toMatchObject({ kind: "unavailable" });
  });

  it("rejects catalog rows whose exact ID disagrees with their identity", () => {
    expect(
      resolveBrowserCell(
        "/vue/agentic-chat",
        catalogWith({ frontend: "react" }),
        runtimeConfig,
      ),
    ).toEqual({
      kind: "malformed",
      reason: "The demo cell identity is inconsistent.",
    });
    expect(
      resolveBrowserCell(
        "/vue/agentic-chat",
        catalogWith({ feature: "frontend-tools" }),
        runtimeConfig,
      ),
    ).toMatchObject({ kind: "malformed" });
  });

  it("fails closed when runtime configuration is absent", () => {
    expect(resolveBrowserCell("/vue/agentic-chat", catalogWith())).toEqual({
      kind: "malformed",
      reason: "The integration runtime manifest is missing or invalid.",
    });
  });

  it("exposes only the agentic-chat same-origin runtime path", () => {
    expect(runtimePathForFeature("agentic-chat")).toBe("/api/copilotkit");
    expect(runtimePathForFeature("frontend-tools")).toBeUndefined();
    expect(runtimePathForFeature("javascript:alert(1)")).toBeUndefined();
  });

  it("fails closed when a runnable catalog row has no Vue runtime route", () => {
    expect(
      resolveBrowserCell(
        "/vue/frontend-tools",
        catalogWith({
          id: "vue/langgraph-python/frontend-tools",
          feature: "frontend-tools",
        }),
        runtimeConfig,
      ),
    ).toEqual({
      kind: "unavailable",
      cellId: "vue/langgraph-python/frontend-tools",
      integration: "langgraph-python",
      feature: "frontend-tools",
      reason: 'Feature "frontend-tools" does not have a Vue runtime route.',
    });
  });
});
