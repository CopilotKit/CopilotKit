import { describe, expect, it } from "vitest";

import { isRunnableBrowserCell, resolveBrowserCell } from "./cell-context";

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
      resolveBrowserCell("/langgraph-python/agentic-chat", catalog),
    ).toEqual({
      kind: "runnable",
      cellId: "angular/langgraph-python/agentic-chat",
      integration: "langgraph-python",
      feature: "agentic-chat",
      runtimeUrl: "/api/copilotkit/langgraph-python/agentic-chat",
    });
  });

  it("keeps non-runnable cells visible with exception metadata", () => {
    expect(
      resolveBrowserCell("/langgraph-python/declarative-json-render", catalog),
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
      "/langgraph-python",
      "/langgraph-python/agentic-chat/extra",
      "/langgraph-python/%61gentic-chat",
      "/https://attacker.example/agentic-chat",
    ]) {
      expect(resolveBrowserCell(path, catalog), path).toMatchObject({
        kind: "malformed",
      });
    }
  });
});
