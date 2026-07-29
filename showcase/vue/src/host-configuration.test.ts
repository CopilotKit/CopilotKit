import { describe, expect, it, vi } from "vitest";

import type { BrowserCellCatalog, VueRuntimeConfig } from "./cell-context";
import {
  bootstrapVueHost,
  resolveHostConfiguration,
} from "./host-configuration";

const runtimeConfig: VueRuntimeConfig = {
  frontendId: "vue",
  integrationId: "langgraph-python",
};

function runnableCatalog(feature = "agentic-chat"): BrowserCellCatalog {
  return {
    cells: [
      {
        id: `vue/langgraph-python/${feature}`,
        frontend: "vue",
        integration: "langgraph-python",
        feature,
        frontend_status: "supported",
        backend_status: "wired",
        runnable: true,
        exception: null,
      },
    ],
  };
}

describe("Vue host configuration", () => {
  it("resolves runtime, agent, thread, suggestions, and feature before mount", () => {
    const events: string[] = [];
    const mount = vi.fn((configuration) => {
      events.push(`mount:${configuration.agentId}`);
      expect(configuration).toEqual({
        cellId: "vue/langgraph-python/agentic-chat",
        integration: "langgraph-python",
        feature: "agentic-chat",
        runtimeUrl: "/api/copilotkit",
        agentId: "agentic_chat",
        threadId: undefined,
        suggestions: [],
        componentKey: "agentic-chat",
      });
    });

    events.push("resolve");
    const resolution = bootstrapVueHost(
      "/vue/agentic-chat",
      runnableCatalog(),
      runtimeConfig,
      mount,
    );

    expect(resolution.kind).toBe("ready");
    expect(events).toEqual(["resolve", "mount:agentic_chat"]);
    expect(mount).toHaveBeenCalledOnce();
  });

  it("does not cross the mount boundary for an unimplemented feature", () => {
    const mount = vi.fn();

    expect(
      bootstrapVueHost(
        "/vue/frontend-tools",
        runnableCatalog("frontend-tools"),
        runtimeConfig,
        mount,
      ),
    ).toMatchObject({
      kind: "unavailable",
      reason: 'Feature "frontend-tools" does not have a Vue runtime route.',
    });
    expect(mount).not.toHaveBeenCalled();
  });

  it("does not resolve a production-style non-runnable Vue cell as ready", () => {
    const catalog = runnableCatalog();
    catalog.cells[0].runnable = false;
    catalog.cells[0].frontend_status = "planned";

    expect(
      resolveHostConfiguration("/vue/agentic-chat", catalog, runtimeConfig),
    ).toMatchObject({ kind: "unavailable" });
  });
});
