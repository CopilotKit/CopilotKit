import { describe, it, expect } from "vitest";
import { CopilotKitCore } from "../core";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { resolveDebugConfig } from "@copilotkit/shared";
import type { ResolvedDebugConfig } from "@copilotkit/shared";

describe("CopilotKitCore debug config", () => {
  it("stores debug: true", () => {
    const core = new CopilotKitCore({ debug: true });
    expect(core.debug).toBe(true);
  });

  it("stores debug object", () => {
    const core = new CopilotKitCore({
      debug: { events: true, lifecycle: false },
    });
    expect(core.debug).toEqual({ events: true, lifecycle: false });
  });

  it("debug is undefined by default", () => {
    const core = new CopilotKitCore({});
    expect(core.debug).toBeUndefined();
  });
});

describe("ProxiedCopilotRuntimeAgent debug config threading", () => {
  it("stores resolved debug config from constructor", () => {
    const debugConfig: ResolvedDebugConfig = resolveDebugConfig(true);
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
      debug: debugConfig,
    });

    expect(agent.debug).toEqual({
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: false,
    });
  });

  it("stores granular resolved debug config", () => {
    const debugConfig: ResolvedDebugConfig = resolveDebugConfig({
      events: true,
      lifecycle: false,
    });
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
      debug: debugConfig,
    });

    expect(agent.debug).toEqual({
      enabled: true,
      events: true,
      lifecycle: false,
      verbose: false,
    });
  });

  it("debug is disabled when not provided", () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
    });

    expect(agent.debug).toEqual({
      enabled: false,
      events: false,
      lifecycle: false,
      verbose: false,
    });
  });

  it("clone() preserves resolved debug config", () => {
    const debugConfig: ResolvedDebugConfig = resolveDebugConfig(true);
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
      debug: debugConfig,
    });

    const cloned = agent.clone();

    expect(cloned.debug).toEqual({
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: false,
    });
  });

  it("clone() preserves verbose debug config", () => {
    const debugConfig: ResolvedDebugConfig = resolveDebugConfig({
      events: true,
      lifecycle: true,
      verbose: true,
    });
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
      debug: debugConfig,
    });

    const cloned = agent.clone();

    expect(cloned.debug).toEqual({
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: true,
    });
  });

  it("clone() preserves disabled debug", () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
    });

    const cloned = agent.clone();

    expect(cloned.debug).toEqual({
      enabled: false,
      events: false,
      lifecycle: false,
      verbose: false,
    });
  });
});
