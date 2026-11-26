import { render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { useFrontendTool } from "../../hooks/use-frontend-tool";
import type { CopilotKitCoreReact } from "../../lib/react-core";

/**
 * The `defaultWebMCPTools` prop. The registration rules themselves are tested
 * in `packages/core/src/core/__tests__/run-handler-webmcp.test.ts`; these
 * assert that the prop reaches the core on mount and on every change, and that
 * a hook tool without `webmcp` reaches `document.modelContext` by default.
 */
let registered: Map<string, unknown>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  registered = new Map();
  (document as Document & { modelContext?: unknown }).modelContext = {
    registerTool: vi.fn(
      async (tool: { name: string }, options: { signal: AbortSignal }) => {
        registered.set(tool.name, tool);
        options.signal.addEventListener("abort", () => {
          registered.delete(tool.name);
        });
      },
    ),
  };
});

afterEach(() => {
  delete (document as Document & { modelContext?: unknown }).modelContext;
  vi.restoreAllMocks();
});

function Tool() {
  useFrontendTool({
    name: "searchOrders",
    description: "Search the user's orders",
    handler: async () => "[]",
  });
  return null;
}

let core: CopilotKitCoreReact | undefined;

function Collector() {
  core = useCopilotKit().copilotkit;
  return null;
}

function tree(defaultWebMCPTools?: boolean) {
  return (
    <CopilotKitProvider defaultWebMCPTools={defaultWebMCPTools}>
      <Tool />
      <Collector />
    </CopilotKitProvider>
  );
}

function renderProvider(defaultWebMCPTools?: boolean) {
  const ui = render(tree(defaultWebMCPTools));
  return {
    getCore: () => core!,
    rerender: (value?: boolean) => ui.rerender(tree(value)),
  };
}

describe("CopilotKitProvider defaultWebMCPTools", () => {
  it("exposes tools without a webmcp flag by default", () => {
    const { getCore } = renderProvider();

    expect(getCore().defaultWebMCPTools).toBe(true);
    expect(registered.has("searchOrders")).toBe(true);
  });

  it("only exposes opted-in tools when set to false", () => {
    const { getCore } = renderProvider(false);

    expect(getCore().defaultWebMCPTools).toBe(false);
    expect(registered.has("searchOrders")).toBe(false);
  });

  it("follows later prop changes", () => {
    const { getCore, rerender } = renderProvider(false);

    rerender(true);
    expect(getCore().defaultWebMCPTools).toBe(true);
    expect(registered.has("searchOrders")).toBe(true);

    rerender(false);
    expect(registered.has("searchOrders")).toBe(false);
  });
});
