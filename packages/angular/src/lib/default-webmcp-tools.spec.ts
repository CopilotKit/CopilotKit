/**
 * The `defaultWebMCPTools` config. The registration rules themselves are
 * tested in `packages/core/src/core/__tests__/run-handler-webmcp.test.ts`;
 * this asserts that the setting reaches the core. Mirrors
 * `react-core/src/v2/providers/__tests__/CopilotKitProvider.defaultWebMCPTools.test.tsx`.
 */
import { EnvironmentInjector } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provideCopilotKit } from "./config";
import type { CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";

function createCopilotKit(config: CopilotKitConfig = {}): CopilotKit {
  TestBed.configureTestingModule({
    providers: [provideCopilotKit(config)],
  });
  return TestBed.inject(CopilotKit);
}

afterEach(() => {
  TestBed.resetTestingModule();
  delete (document as Document & { modelContext?: unknown }).modelContext;
});

describe("provideCopilotKit defaultWebMCPTools", () => {
  it("is on by default", () => {
    expect(createCopilotKit().core.defaultWebMCPTools).toBe(true);
  });

  it("can be turned off", () => {
    expect(
      createCopilotKit({ defaultWebMCPTools: false }).core.defaultWebMCPTools,
    ).toBe(false);
  });

  it("removes the WebMCP registrations when the injector is destroyed", () => {
    const registered = new Set<string>();
    (document as Document & { modelContext?: unknown }).modelContext = {
      registerTool: vi.fn(
        async (tool: { name: string }, options: { signal: AbortSignal }) => {
          registered.add(tool.name);
          options.signal.addEventListener("abort", () => {
            registered.delete(tool.name);
          });
        },
      ),
    };

    createCopilotKit({
      tools: [
        {
          name: "configTool",
          description: "Passed to provideCopilotKit",
          handler: async () => "ok",
        },
      ],
    });
    expect(registered.has("configTool")).toBe(true);

    // The test setup turns off destroyAfterEach, so destroy it here.
    TestBed.inject(EnvironmentInjector).destroy();

    expect(registered.size).toBe(0);
  });
});
