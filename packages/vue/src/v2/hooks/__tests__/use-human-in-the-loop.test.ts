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
      agents__unsafe_dev_only: {
        "test-agent": new StateCapturingAgent(
          [],
          "test-agent",
        ) as unknown as AbstractAgent,
      },
    });

    const registeredTool = getCore().getTool({ toolName: "approveTool" });
    const renderer = getCore().renderToolCalls.find(
      (rc) => rc.name === "approveTool",
    );

    expect(registeredTool?.handler).toBeDefined();
    expect(renderer).toBeDefined();

    const pending = registeredTool!.handler!(
      { question: "Proceed?" },
      {} as never,
    );

    const executingVNode = renderer!.render({
      name: "approveTool",
      toolCallId: "tc-approve",
      args: { question: "Proceed?" },
      status: "executing",
      result: undefined,
    });

    const respond = (
      executingVNode as { props?: { respond?: (result: unknown) => void } }
    )?.props?.respond;
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

    const ToolA = {
      name: "toolA",
      parameters: z.object({}),
      render: RenderComp,
    };
    const ToolB = {
      name: "toolB",
      parameters: z.object({}),
      render: RenderComp,
    };

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

    const respondA = (
      renderA!.render({
        name: "toolA",
        toolCallId: "tc-a",
        args: {},
        status: "executing",
        result: undefined,
      }) as {
        props?: { respond?: (result: unknown) => void };
      }
    ).props?.respond;
    const respondB = (
      renderB!.render({
        name: "toolB",
        toolCallId: "tc-b",
        args: {},
        status: "executing",
        result: undefined,
      }) as {
        props?: { respond?: (result: unknown) => void };
      }
    ).props?.respond;

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
        useHumanInTheLoop({
          name: "approveTool",
          parameters: z.object({}),
          render: RenderComp,
        });
        return () => null;
      },
    });

    const { getCore } = mountWithProvider(() => h(Child));
    const renderer = getCore().renderToolCalls.find(
      (rc) => rc.name === "approveTool",
    );

    const inProgress = renderer!.render({
      name: "approveTool",
      toolCallId: "tc-status",
      args: {},
      status: "inProgress",
      result: undefined,
    }) as {
      props?: { respond?: unknown };
    };
    const executing = renderer!.render({
      name: "approveTool",
      toolCallId: "tc-status",
      args: {},
      status: "executing",
      result: undefined,
    }) as {
      props?: { respond?: unknown };
    };
    const complete = renderer!.render({
      name: "approveTool",
      toolCallId: "tc-status",
      args: {},
      status: "complete",
      result: "ok",
    }) as {
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
            h(
              "button",
              {
                "data-testid": "toggle",
                onClick: () => (shown.value = !shown.value),
              },
              "toggle",
            ),
            shown.value
              ? h(
                  defineComponent({
                    setup() {
                      useHumanInTheLoop({
                        name: "cleanupTool",
                        parameters: z.object({}),
                        render: RenderComp,
                      });
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
    expect(
      getCore().renderToolCalls.find((rc) => rc.name === "cleanupTool"),
    ).toBeDefined();

    await wrapper.find("[data-testid=toggle]").trigger("click");
    await nextTick();

    expect(getCore().getTool({ toolName: "cleanupTool" })).toBeUndefined();
    expect(
      getCore().renderToolCalls.find((rc) => rc.name === "cleanupTool"),
    ).toBeUndefined();
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
        useHumanInTheLoop(
          { name: "depHitl", parameters: z.object({}), render: RenderComp },
          [version],
        );
        return () =>
          h(
            "button",
            { "data-testid": "bump", onClick: () => (version.value += 1) },
            "bump",
          );
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

  describe("Vue-specific HITL lifecycle semantics", () => {
    function mountHitlTool(agentId?: string) {
      const RenderComp = defineComponent({
        setup() {
          return () => h("div");
        },
      });
      const Child = defineComponent({
        setup() {
          useHumanInTheLoop({
            name: "lifecycleTool",
            description: "Lifecycle description",
            agentId,
            parameters: z.object({ value: z.string() }),
            render: RenderComp,
          });
          return () => null;
        },
      });
      const mounted = mountWithProvider(() => h(Child));
      const core = mounted.getCore();
      return {
        ...mounted,
        handler: core.getTool({ toolName: "lifecycleTool", agentId })!.handler!,
        renderer: core.renderToolCalls.find(
          (renderTool) =>
            renderTool.name === "lifecycleTool" &&
            renderTool.agentId === agentId,
        )!,
      };
    }

    it("rejects an already-aborted signal with the exact HITL error", async () => {
      const { handler } = mountHitlTool();
      const controller = new AbortController();
      controller.abort();

      await expect(handler!({}, { signal: controller.signal })).rejects.toEqual(
        new Error("Human-in-the-loop interaction aborted"),
      );
    });

    it("rejects once on abort, clears pending refs, and installs a one-shot listener", async () => {
      const { handler, renderer } = mountHitlTool();
      const listeners = new Set<() => void>();
      const signal = {
        aborted: false,
        addEventListener: vi.fn(
          (_type: string, listener: () => void, options) => {
            expect(options).toEqual({ once: true });
            listeners.add(listener);
          },
        ),
        removeEventListener: vi.fn((_type: string, listener: () => void) => {
          listeners.delete(listener);
        }),
      } as unknown as AbortSignal;

      const pending = handler!({}, { signal });
      expect(listeners.size).toBe(1);
      const onAbort = [...listeners][0];
      onAbort();
      onAbort();

      await expect(pending).rejects.toEqual(
        new Error("Human-in-the-loop interaction aborted"),
      );
      const respond = (
        renderer.render({
          name: "lifecycleTool",
          toolCallId: "tc-aborted",
          args: {},
          status: "executing",
          result: undefined,
        }) as { props?: { respond?: (result: unknown) => Promise<void> } }
      ).props?.respond;
      await respond?.("late response");
    });

    it("removes the abort listener before respond resolves and ignores a late abort", async () => {
      const { handler, renderer } = mountHitlTool();
      const events: string[] = [];
      let onAbort: (() => void) | undefined;
      const signal = {
        aborted: false,
        addEventListener: vi.fn((_type: string, listener: () => void) => {
          onAbort = listener;
        }),
        removeEventListener: vi.fn(() => {
          events.push("removed");
        }),
      } as unknown as AbortSignal;

      const pending = handler!({}, { signal }).then((result) => {
        events.push(`resolved:${String(result)}`);
        return result;
      });
      const respond = (
        renderer.render({
          name: "lifecycleTool",
          toolCallId: "tc-respond",
          args: {},
          status: "executing",
          result: undefined,
        }) as { props?: { respond?: (result: unknown) => Promise<void> } }
      ).props?.respond;

      await respond!("approved");
      onAbort?.();
      await expect(pending).resolves.toBe("approved");
      expect(events).toEqual(["removed", "resolved:approved"]);
    });

    it("passes toolCallId and registration agentId through every HITL status", () => {
      const { renderer } = mountHitlTool("research-agent");
      const shared = { name: "lifecycleTool", toolCallId: "tc-props" };
      const inProgress = renderer.render({
        ...shared,
        args: { value: "partial" },
        status: "inProgress",
        result: undefined,
      }) as { props?: Record<string, unknown> };
      const executing = renderer.render({
        ...shared,
        args: { value: "complete-args" },
        status: "executing",
        result: undefined,
      }) as { props?: Record<string, unknown> };
      const complete = renderer.render({
        ...shared,
        args: { value: "complete-args" },
        status: "complete",
        result: "done",
      }) as { props?: Record<string, unknown> };

      for (const vnode of [inProgress, executing, complete]) {
        expect(vnode.props?.name).toBe("lifecycleTool");
        expect(vnode.props?.description).toBe("Lifecycle description");
        expect(vnode.props?.toolCallId).toBe("tc-props");
        expect(vnode.props?.agentId).toBe("research-agent");
      }
      expect(inProgress.props?.args).toEqual({ value: "partial" });
      expect(inProgress.props?.result).toBeUndefined();
      expect(executing.props?.args).toEqual({ value: "complete-args" });
      expect(executing.props?.result).toBeUndefined();
      expect(complete.props?.args).toEqual({ value: "complete-args" });
      expect(complete.props?.result).toBe("done");
      expect(inProgress.props?.respond).toBeUndefined();
      expect(typeof executing.props?.respond).toBe("function");
      expect(complete.props?.respond).toBeUndefined();
    });

    it("removes only the agent-scoped renderer on scope disposal", async () => {
      const RenderComp = defineComponent({
        setup() {
          return () => h("div");
        },
      });
      const createScopedChild = (agentId: string) =>
        defineComponent({
          setup() {
            useHumanInTheLoop({
              name: "sharedLifecycleTool",
              agentId,
              parameters: z.object({}),
              render: RenderComp,
            });
            return () => null;
          },
        });
      const ScopedA = createScopedChild("agent-a");
      const ScopedB = createScopedChild("agent-b");
      const Parent = defineComponent({
        setup() {
          const showA = ref(true);
          return () =>
            h("div", [
              h("button", {
                "data-testid": "dispose-agent-a",
                onClick: () => (showA.value = false),
              }),
              showA.value ? h(ScopedA) : null,
              h(ScopedB),
            ]);
        },
      });

      const { wrapper, getCore } = mountWithProvider(() => h(Parent));
      await nextTick();
      const renderers = () =>
        getCore().renderToolCalls.filter(
          (renderer) => renderer.name === "sharedLifecycleTool",
        );
      expect(renderers().map((renderer) => renderer.agentId)).toEqual([
        "agent-a",
        "agent-b",
      ]);

      await wrapper.find("[data-testid=dispose-agent-a]").trigger("click");
      await nextTick();

      expect(renderers().map((renderer) => renderer.agentId)).toEqual([
        "agent-b",
      ]);
      expect(
        getCore().getTool({
          toolName: "sharedLifecycleTool",
          agentId: "agent-b",
        }),
      ).toBeDefined();
    });

    it("leaves agentId undefined for an unscoped HITL tool", () => {
      const { renderer } = mountHitlTool();
      const vnode = renderer.render({
        name: "lifecycleTool",
        toolCallId: "tc-unscoped",
        args: {},
        status: "executing",
        result: undefined,
      }) as { props?: Record<string, unknown> };

      expect(vnode.props?.agentId).toBeUndefined();
    });

    it("does not settle a pending HITL promise when its renderer unmounts", async () => {
      const mounted = mountHitlTool();
      const pending = mounted.handler({}, {});
      mounted.wrapper.unmount();

      const outcome = await Promise.race([
        pending.then(
          () => "settled",
          () => "settled",
        ),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 0)),
      ]);
      expect(outcome).toBe("pending");
    });
  });
});
