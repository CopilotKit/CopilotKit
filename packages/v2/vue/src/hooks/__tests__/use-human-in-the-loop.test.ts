import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { z } from "zod";
import type { AbstractAgent } from "@ag-ui/client";
import { useHumanInTheLoop } from "../use-human-in-the-loop";
import { mountWithProvider } from "../../__tests__/utils/mount";
import { StateCapturingAgent } from "../../__tests__/utils/agents";

describe("useHumanInTheLoop", () => {
  beforeEach(() => {
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  it("resolves handler promise only via respond", async () => {
    const RenderComp = defineComponent({
      props: ["status", "respond"],
      setup() {
        return () => h("div");
      },
    });

    const tool = {
      name: "approveTool",
      description: "Approve",
      parameters: z.object({ question: z.string() }),
      render: RenderComp,
    };

    const Child = defineComponent({
      setup() {
        useHumanInTheLoop(tool);
        return () => null;
      },
    });

    const { getCore } = mountWithProvider(() => h(Child), {
      agents__unsafe_dev_only: { "test-agent": new StateCapturingAgent([], "test-agent") as unknown as AbstractAgent },
    });

    const registeredTool = getCore().getTool({ toolName: "approveTool" });
    const renderer = getCore().renderToolCalls.find((rc) => rc.name === "approveTool");

    expect(registeredTool?.handler).toBeDefined();
    expect(renderer).toBeDefined();

    const pending = registeredTool!.handler!({ question: "Proceed?" }, {} as never);

    const executingVNode = renderer!.render({
      name: "approveTool",
      args: { question: "Proceed?" },
      status: "executing",
      result: undefined,
    });

    const respond = (executingVNode as { props?: { respond?: (result: unknown) => void } })?.props?.respond;
    expect(typeof respond).toBe("function");

    respond?.({ approved: true });

    await expect(pending).resolves.toEqual({ approved: true });
  });

  it("keeps HITL registrations isolated", async () => {
    const RenderComp = defineComponent({
      props: ["respond"],
      setup() {
        return () => h("div");
      },
    });

    const ToolA = { name: "toolA", parameters: z.object({}), render: RenderComp };
    const ToolB = { name: "toolB", parameters: z.object({}), render: RenderComp };

    const Child = defineComponent({
      setup() {
        useHumanInTheLoop(ToolA);
        useHumanInTheLoop(ToolB);
        return () => null;
      },
    });

    const { getCore } = mountWithProvider(() => h(Child));
    const toolA = getCore().getTool({ toolName: "toolA" });
    const toolB = getCore().getTool({ toolName: "toolB" });
    const renderA = getCore().renderToolCalls.find((rc) => rc.name === "toolA");
    const renderB = getCore().renderToolCalls.find((rc) => rc.name === "toolB");

    const pA = toolA!.handler!({}, {} as never);
    const pB = toolB!.handler!({}, {} as never);

    const respondA = (renderA!.render({ name: "toolA", args: {}, status: "executing", result: undefined }) as {
      props?: { respond?: (result: unknown) => void };
    }).props?.respond;
    const respondB = (renderB!.render({ name: "toolB", args: {}, status: "executing", result: undefined }) as {
      props?: { respond?: (result: unknown) => void };
    }).props?.respond;

    respondA?.("A");
    respondB?.("B");

    await expect(pA).resolves.toBe("A");
    await expect(pB).resolves.toBe("B");
  });

  it("only exposes respond during executing status", () => {
    const RenderComp = defineComponent({
      props: ["respond"],
      setup() {
        return () => h("div");
      },
    });

    const Child = defineComponent({
      setup() {
        useHumanInTheLoop({ name: "approveTool", parameters: z.object({}), render: RenderComp });
        return () => null;
      },
    });

    const { getCore } = mountWithProvider(() => h(Child));
    const renderer = getCore().renderToolCalls.find((rc) => rc.name === "approveTool");

    const inProgress = renderer!.render({ name: "approveTool", args: {}, status: "inProgress", result: undefined }) as {
      props?: { respond?: unknown };
    };
    const executing = renderer!.render({ name: "approveTool", args: {}, status: "executing", result: undefined }) as {
      props?: { respond?: unknown };
    };
    const complete = renderer!.render({ name: "approveTool", args: {}, status: "complete", result: "ok" }) as {
      props?: { respond?: unknown };
    };

    expect(inProgress.props?.respond).toBeUndefined();
    expect(typeof executing.props?.respond).toBe("function");
    expect(complete.props?.respond).toBeUndefined();
  });

  it("cleans up tool and renderer on unmount", async () => {
    const RenderComp = defineComponent({
      setup() {
        return () => h("div");
      },
    });

    const Parent = defineComponent({
      setup() {
        const shown = ref(true);
        return () =>
          h("div", [
            h("button", { "data-testid": "toggle", onClick: () => (shown.value = !shown.value) }, "toggle"),
            shown.value
              ? h(
                  defineComponent({
                    setup() {
                      useHumanInTheLoop({ name: "cleanupTool", parameters: z.object({}), render: RenderComp });
                      return () => null;
                    },
                  }),
                )
              : null,
          ]);
      },
    });

    const { wrapper, getCore } = mountWithProvider(() => h(Parent));
    await nextTick();

    expect(getCore().getTool({ toolName: "cleanupTool" })).toBeDefined();
    expect(getCore().renderToolCalls.find((rc) => rc.name === "cleanupTool")).toBeDefined();

    await wrapper.find("[data-testid=toggle]").trigger("click");
    await nextTick();

    expect(getCore().getTool({ toolName: "cleanupTool" })).toBeUndefined();
    expect(getCore().renderToolCalls.find((rc) => rc.name === "cleanupTool")).toBeUndefined();
  });

  it("re-registers when deps change", async () => {
    const RenderComp = defineComponent({
      setup() {
        return () => h("div");
      },
    });

    const version = ref(0);
    const Child = defineComponent({
      setup() {
        useHumanInTheLoop({ name: "depHitl", parameters: z.object({}), render: RenderComp }, [version]);
        return () => h("button", { "data-testid": "bump", onClick: () => (version.value += 1) }, "bump");
      },
    });

    const { wrapper, getCore } = mountWithProvider(() => h(Child));
    const addToolSpy = vi.spyOn(getCore(), "addTool");

    await wrapper.find("[data-testid=bump]").trigger("click");
    await nextTick();

    expect(addToolSpy).toHaveBeenCalled();
    expect(getCore().getTool({ toolName: "depHitl" })).toBeDefined();
    addToolSpy.mockRestore();
  });
});
