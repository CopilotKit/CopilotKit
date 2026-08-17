import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import type { VNode } from "vue";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import type { VueFrontendTool, VueHumanInTheLoop } from "../../types";
import { mountWithProvider } from "../../__tests__/utils/mount";

describe("CopilotKitProvider wildcard behavior", () => {
  it("registers wildcard frontend tool", () => {
    const wildcardHandler = vi.fn();
    const frontendTools: VueFrontendTool[] = [
      {
        name: "*",
        description: "Fallback tool",
        handler: wildcardHandler,
      },
    ];

    const { getCore } = mountWithProvider(() => h("div"), { frontendTools });
    const retrievedTool = getCore().getTool({ toolName: "*" });

    expect(retrievedTool).toBeDefined();
    expect(retrievedTool?.name).toBe("*");
    expect(retrievedTool?.handler).toBe(wildcardHandler);
  });

  it("registers wildcard alongside specific tool", () => {
    const frontendTools: VueFrontendTool[] = [
      { name: "specific", handler: vi.fn() },
      { name: "*", handler: vi.fn() },
    ];

    const { getCore } = mountWithProvider(() => h("div"), { frontendTools });

    expect(getCore().getTool({ toolName: "specific" })).toBeDefined();
    expect(getCore().getTool({ toolName: "*" })).toBeDefined();
  });

  it("registers wildcard with render in renderToolCalls", () => {
    const WildcardRender = defineComponent({
      setup() {
        return () => h("div", "Wildcard");
      },
    });

    const frontendTools: VueFrontendTool[] = [
      {
        name: "*",
        description: "Fallback with render",
        parameters: z.object({ toolName: z.string(), args: z.unknown() }),
        render: WildcardRender,
      },
    ];

    const { getCore } = mountWithProvider(() => h("div"), { frontendTools });
    const wildcardRender = getCore().renderToolCalls.find(
      (rc) => rc.name === "*",
    );

    expect(wildcardRender).toBeDefined();
    expect(wildcardRender?.render).toStrictEqual(WildcardRender);
  });

  it("supports wildcard with agentId", () => {
    const frontendTools: VueFrontendTool[] = [
      {
        name: "*",
        handler: vi.fn(),
        agentId: "agent-1",
      },
    ];

    const { getCore } = mountWithProvider(() => h("div"), { frontendTools });
    const wildcard = getCore().getTool({ toolName: "*", agentId: "agent-1" });

    expect(wildcard).toBeDefined();
    expect(wildcard?.agentId).toBe("agent-1");
  });

  it("supports wildcard in humanInTheLoop", () => {
    const WildcardComponent = defineComponent({
      setup() {
        return () => h("div", "Wildcard HITL");
      },
    });

    const humanInTheLoop: VueHumanInTheLoop[] = [
      {
        name: "*",
        description: "Fallback interaction",
        parameters: z.object({ toolName: z.string(), args: z.unknown() }),
        render: WildcardComponent,
      },
    ];

    const { getCore } = mountWithProvider(() => h("div"), { humanInTheLoop });

    expect(getCore().getTool({ toolName: "*" })).toBeDefined();
    const wildcardRender = getCore().renderToolCalls.find(
      (rc) => rc.name === "*",
    );
    expect(wildcardRender).toBeDefined();
    // A humanInTheLoop render is wrapped so `respond` can be injected, so it is
    // not the component itself — assert it delegates to it, and that the
    // wildcard receives the name of the tool that was actually invoked.
    const vnode = (
      wildcardRender?.render as (p: Record<string, unknown>) => VNode
    )({
      name: "someTool",
      toolCallId: "tc-1",
      args: { toolName: "someTool", args: {} },
      status: ToolCallStatus.Executing,
      result: undefined,
    });
    expect(vnode.type).toStrictEqual(WildcardComponent);
    expect((vnode.props as { name?: string })?.name).toBe("someTool");
  });
});
