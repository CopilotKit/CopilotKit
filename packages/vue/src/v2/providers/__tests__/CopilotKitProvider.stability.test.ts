import { cleanup, render } from "@testing-library/vue";
import { defineComponent, nextTick, ref, watchEffect } from "vue";
import type { Component, PropType } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { VueFrontendTool } from "../../types";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { useCopilotKit } from "../useCopilotKit";
import type { CopilotKitContextValue } from "../keys";
import { useFrontendTool } from "../../hooks/use-frontend-tool";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function renderProvider(args: {
  child: Component;
  frontendTools?: VueFrontendTool[];
  runtimeUrl?: string;
}) {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      ChildComponent: args.child,
    },
    props: {
      frontendTools: {
        type: Array as PropType<VueFrontendTool[]>,
        required: false,
      },
      runtimeUrl: {
        type: String,
        required: false,
      },
    },
    template: `
      <CopilotKitProvider :runtime-url="runtimeUrl" :frontend-tools="frontendTools">
        <ChildComponent />
      </CopilotKitProvider>
    `,
  });

  return render(Host, {
    props: {
      frontendTools: args.frontendTools,
      runtimeUrl: args.runtimeUrl,
    },
  });
}

describe("CopilotKitProvider stability", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    global.fetch = originalFetch;
  });

  describe("instance stability", () => {
    it("returns the same copilotkit instance after re-render with new renderToolCalls array", async () => {
      const instances: CopilotKitCoreVue[] = [];

      const Collector = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          watchEffect(() => {
            instances.push(copilotkit.value);
          });
          return () => null;
        },
      });

      const Renderer1 = defineComponent({ template: "<div>Tool 1</div>" });
      const Renderer2 = defineComponent({
        template: "<div>Tool 1 updated</div>",
      });

      const renderToolCalls1: VueFrontendTool[] = [
        {
          name: "tool1",
          description: "Tool 1",
          parameters: z.object({ a: z.string() }),
          render: Renderer1,
        },
      ];

      const renderToolCalls2: VueFrontendTool[] = [
        {
          name: "tool1",
          description: "Tool 1",
          parameters: z.object({ a: z.string() }),
          render: Renderer2,
        },
      ];

      const view = renderProvider({
        child: Collector,
        runtimeUrl: "/api/copilotkit",
        frontendTools: renderToolCalls1,
      });

      await nextTick();
      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        frontendTools: renderToolCalls2,
      });
      await nextTick();

      expect(instances.length).toBeGreaterThanOrEqual(2);
      const first = instances[0];
      for (const instance of instances) {
        expect(instance).toBe(first);
      }
    });

    it("returns the same copilotkit instance after re-render with new frontendTools array", async () => {
      const instances: CopilotKitCoreVue[] = [];

      const Collector = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          watchEffect(() => {
            instances.push(copilotkit.value);
          });
          return () => null;
        },
      });

      const tools1: VueFrontendTool[] = [
        { name: "toolA", description: "Tool A", handler: vi.fn() },
      ];
      const tools2: VueFrontendTool[] = [
        { name: "toolB", description: "Tool B", handler: vi.fn() },
      ];

      const view = renderProvider({
        child: Collector,
        runtimeUrl: "/api/copilotkit",
        frontendTools: tools1,
      });

      await nextTick();
      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        frontendTools: tools2,
      });
      await nextTick();

      expect(instances.length).toBeGreaterThanOrEqual(2);
      const first = instances[0];
      for (const instance of instances) {
        expect(instance).toBe(first);
      }
    });
  });

  describe("context value stability", () => {
    it("does not change context value reference when only tools change", async () => {
      const contextValues: CopilotKitContextValue[] = [];

      const Collector = defineComponent({
        setup() {
          const context = useCopilotKit();
          watchEffect(() => {
            void context.copilotkit.value;
            void context.executingToolCallIds.value;
            contextValues.push(context);
          });
          return () => null;
        },
      });

      const tools1: VueFrontendTool[] = [
        { name: "toolA", description: "Tool A" },
      ];
      const tools2: VueFrontendTool[] = [
        { name: "toolB", description: "Tool B" },
      ];

      const view = renderProvider({
        child: Collector,
        runtimeUrl: "/api/copilotkit",
        frontendTools: tools1,
      });

      await nextTick();
      const initialContext = contextValues[contextValues.length - 1];

      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        frontendTools: tools2,
      });
      await nextTick();

      const afterRerender = contextValues[contextValues.length - 1];
      expect(afterRerender?.copilotkit).toBe(initialContext?.copilotkit);
      expect(afterRerender?.executingToolCallIds).toBe(
        initialContext?.executingToolCallIds,
      );
    });
  });

  describe("setter calls on prop changes", () => {
    it("calls setTools when frontendTools change instead of recreating instance", async () => {
      const setToolsSpy = vi.fn();
      let spyAttached = false;

      const SpyAttacher = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          if (!spyAttached) {
            const originalSetTools = copilotkit.value.setTools.bind(
              copilotkit.value,
            );
            copilotkit.value.setTools = (tools) => {
              setToolsSpy(tools);
              return originalSetTools(tools);
            };
            spyAttached = true;
          }
          return () => null;
        },
      });

      const tools1: VueFrontendTool[] = [
        { name: "toolA", description: "Tool A", handler: vi.fn() },
      ];
      const tools2: VueFrontendTool[] = [
        { name: "toolB", description: "Tool B", handler: vi.fn() },
      ];

      const view = renderProvider({
        child: SpyAttacher,
        runtimeUrl: "/api/copilotkit",
        frontendTools: tools1,
      });

      await nextTick();
      setToolsSpy.mockClear();

      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        frontendTools: tools2,
      });
      await nextTick();

      expect(setToolsSpy).toHaveBeenCalled();
    });

    it("calls setRenderToolCalls when renderToolCalls change", async () => {
      const setRenderToolCallsSpy = vi.fn();
      let spyAttached = false;

      const SpyAttacher = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          if (!spyAttached) {
            const original = copilotkit.value.setRenderToolCalls.bind(
              copilotkit.value,
            );
            copilotkit.value.setRenderToolCalls = (renderToolCalls) => {
              setRenderToolCallsSpy(renderToolCalls);
              return original(renderToolCalls);
            };
            spyAttached = true;
          }
          return () => null;
        },
      });

      const Renderer1 = defineComponent({ template: "<div>R1</div>" });
      const Renderer2 = defineComponent({ template: "<div>R2</div>" });

      const rtc1: VueFrontendTool[] = [
        {
          name: "render1",
          description: "Render 1",
          parameters: z.object({ x: z.string() }),
          render: Renderer1,
        },
      ];
      const rtc2: VueFrontendTool[] = [
        {
          name: "render2",
          description: "Render 2",
          parameters: z.object({ y: z.string() }),
          render: Renderer2,
        },
      ];

      const view = renderProvider({
        child: SpyAttacher,
        runtimeUrl: "/api/copilotkit",
        frontendTools: rtc1,
      });

      await nextTick();
      setRenderToolCallsSpy.mockClear();

      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        frontendTools: rtc2,
      });
      await nextTick();

      expect(setRenderToolCallsSpy).toHaveBeenCalled();
    });
  });

  describe("no unnecessary re-renders from stable props", () => {
    it("does not re-render children when provider re-renders with same stable props", async () => {
      let childRenderCount = 0;

      const Child = defineComponent({
        setup() {
          childRenderCount++;
          useCopilotKit();
          return () => "child";
        },
      });

      const stableTools: VueFrontendTool[] = [
        { name: "tool1", description: "Tool 1" },
      ];

      const view = renderProvider({
        child: Child,
        runtimeUrl: "/api/copilotkit",
        frontendTools: stableTools,
      });

      await nextTick();
      const initialCount = childRenderCount;

      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        frontendTools: stableTools,
      });
      await nextTick();

      expect(childRenderCount - initialCount).toBeLessThanOrEqual(1);
    });
  });

  describe("setter effects skip initial mount (didMountRef guard)", () => {
    it("does not call setTools on initial mount (constructor handles it)", async () => {
      const tools: VueFrontendTool[] = [
        { name: "tool1", description: "Tool 1" },
      ];
      const setToolsCalls: unknown[][] = [];
      let spyAttached = false;

      const SpyAttacher = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          if (!spyAttached) {
            const originalSetTools = copilotkit.value.setTools.bind(
              copilotkit.value,
            );
            copilotkit.value.setTools = (nextTools) => {
              setToolsCalls.push([nextTools]);
              return originalSetTools(nextTools);
            };
            spyAttached = true;
          }
          return () => null;
        },
      });

      renderProvider({
        child: SpyAttacher,
        runtimeUrl: "/api/copilotkit",
        frontendTools: tools,
      });

      await nextTick();
      expect(setToolsCalls).toHaveLength(0);
    });

    it("does not call setRenderToolCalls on initial mount", async () => {
      const calls: unknown[][] = [];
      let spyAttached = false;

      const SpyAttacher = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          if (!spyAttached) {
            const original = copilotkit.value.setRenderToolCalls.bind(
              copilotkit.value,
            );
            copilotkit.value.setRenderToolCalls = (renderToolCalls) => {
              calls.push([renderToolCalls]);
              return original(renderToolCalls);
            };
            spyAttached = true;
          }
          return () => null;
        },
      });

      const Renderer = defineComponent({ template: "<div>R1</div>" });

      const rtc: VueFrontendTool[] = [
        {
          name: "render1",
          description: "Render 1",
          parameters: z.object({ x: z.string() }),
          render: Renderer,
        },
      ];

      renderProvider({
        child: SpyAttacher,
        runtimeUrl: "/api/copilotkit",
        frontendTools: rtc,
      });

      await nextTick();
      expect(calls).toHaveLength(0);
    });
  });

  describe("dynamic tool preservation on mount", () => {
    it("preserves dynamically registered tools from child hooks after provider mounts", async () => {
      let core: CopilotKitCoreVue | null = null;

      const DynamicToolChild = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          core = copilotkit.value;
          useFrontendTool({
            name: "dynamicTool",
            description: "A dynamically registered tool",
            handler: async () => "result",
          });
          return () => null;
        },
      });

      const providerTools: VueFrontendTool[] = [
        {
          name: "providerTool",
          description: "From provider props",
          handler: vi.fn(),
        },
      ];

      renderProvider({
        child: DynamicToolChild,
        runtimeUrl: "/api/copilotkit",
        frontendTools: providerTools,
      });

      await nextTick();
      expect(core).toBeTruthy();
      expect(core?.getTool({ toolName: "dynamicTool" })).toBeDefined();
      expect(core?.getTool({ toolName: "providerTool" })).toBeDefined();
    });

    it("preserves dynamically registered render tool calls from child hooks after provider mounts", async () => {
      let core: CopilotKitCoreVue | null = null;

      const DynamicRenderChild = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          core = copilotkit.value;
          useFrontendTool({
            name: "renderableTool",
            description: "Has a render function",
            parameters: z.object({ msg: z.string() }),
            handler: async () => "ok",
            render: defineComponent({ template: "<div>Rendered!</div>" }),
          });
          return () => null;
        },
      });

      const providerRtc: VueFrontendTool[] = [
        {
          name: "providerRenderer",
          description: "Provider render",
          parameters: z.object({ x: z.string() }),
          render: defineComponent({ template: "<div>Provider Render</div>" }),
        },
      ];

      renderProvider({
        child: DynamicRenderChild,
        runtimeUrl: "/api/copilotkit",
        frontendTools: providerRtc,
      });

      await nextTick();
      expect(core).toBeTruthy();
      const renderToolCalls = core?.renderToolCalls ?? [];
      expect(
        renderToolCalls.find((t) => t.name === "providerRenderer"),
      ).toBeDefined();
      expect(
        renderToolCalls.find((t) => t.name === "renderableTool"),
      ).toBeDefined();
    });
  });

  describe("Vue remount lifecycle", () => {
    it("creates a fresh copilotkit instance on remount", async () => {
      const instances: CopilotKitCoreVue[] = [];

      const Collector = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          instances.push(copilotkit.value);
          return () => null;
        },
      });

      const view1 = renderProvider({
        child: Collector,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      view1.unmount();

      const view2 = renderProvider({
        child: Collector,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      view2.unmount();

      expect(instances).toHaveLength(2);
      expect(instances[1]).not.toBe(instances[0]);
    });

    it("creates fresh context references on remount", async () => {
      const contextValues: CopilotKitContextValue[] = [];

      const Collector = defineComponent({
        setup() {
          contextValues.push(useCopilotKit());
          return () => null;
        },
      });

      const view1 = renderProvider({
        child: Collector,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      view1.unmount();

      const view2 = renderProvider({
        child: Collector,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      view2.unmount();

      expect(contextValues).toHaveLength(2);
      expect(contextValues[1]?.copilotkit).not.toBe(
        contextValues[0]?.copilotkit,
      );
      expect(contextValues[1]?.executingToolCallIds).not.toBe(
        contextValues[0]?.executingToolCallIds,
      );
    });

    it("preserves dynamically registered tools after remount", async () => {
      const capturedInstances: CopilotKitCoreVue[] = [];

      const DynamicToolChild = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          capturedInstances.push(copilotkit.value);

          useFrontendTool({
            name: "remountTool",
            description: "Registered after remount",
            handler: async () => "ok",
          });

          return () => null;
        },
      });

      const view1 = renderProvider({
        child: DynamicToolChild,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      expect(
        capturedInstances[0]?.getTool({ toolName: "remountTool" }),
      ).toBeDefined();
      view1.unmount();

      const view2 = renderProvider({
        child: DynamicToolChild,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      expect(
        capturedInstances[1]?.getTool({ toolName: "remountTool" }),
      ).toBeDefined();
      expect(capturedInstances[1]).not.toBe(capturedInstances[0]);
      view2.unmount();
    });

    it("preserves dynamically registered render tool calls after remount", async () => {
      const capturedInstances: CopilotKitCoreVue[] = [];

      const DynamicRenderChild = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          capturedInstances.push(copilotkit.value);

          useFrontendTool({
            name: "remountRenderTool",
            description: "Render survives remount",
            parameters: z.object({ topic: z.string() }),
            handler: async () => "ok",
            render: defineComponent({ template: "<div>Rendered!</div>" }),
          });

          return () => null;
        },
      });

      const view1 = renderProvider({
        child: DynamicRenderChild,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      expect(
        capturedInstances[0]?.renderToolCalls.find(
          (r) => r.name === "remountRenderTool",
        ),
      ).toBeDefined();
      view1.unmount();

      const view2 = renderProvider({
        child: DynamicRenderChild,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      expect(
        capturedInstances[1]?.renderToolCalls.find(
          (r) => r.name === "remountRenderTool",
        ),
      ).toBeDefined();
      expect(capturedInstances[1]).not.toBe(capturedInstances[0]);
      view2.unmount();
    });

    it("hook render entries coexist with prop render entries after remount", async () => {
      const capturedInstances: CopilotKitCoreVue[] = [];

      const DynamicRenderChild = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          capturedInstances.push(copilotkit.value);

          useFrontendTool({
            name: "hookTool",
            description: "Registered via hook",
            parameters: z.object({ x: z.string() }),
            handler: async () => "ok",
            render: defineComponent({ template: "<div>Hook render</div>" }),
          });

          return () => null;
        },
      });

      const propRtc: VueFrontendTool[] = [
        {
          name: "propTool",
          description: "Prop tool",
          parameters: z.object({ y: z.string() }),
          render: defineComponent({ template: "<div>Prop render</div>" }),
        },
      ];

      const view1 = renderProvider({
        child: DynamicRenderChild,
        runtimeUrl: "/api/copilotkit",
        frontendTools: propRtc,
      });
      await nextTick();
      expect(
        capturedInstances[0]?.renderToolCalls.find(
          (r) => r.name === "propTool",
        ),
      ).toBeDefined();
      expect(
        capturedInstances[0]?.renderToolCalls.find(
          (r) => r.name === "hookTool",
        ),
      ).toBeDefined();
      view1.unmount();

      const view2 = renderProvider({
        child: DynamicRenderChild,
        runtimeUrl: "/api/copilotkit",
        frontendTools: propRtc,
      });
      await nextTick();
      expect(
        capturedInstances[1]?.renderToolCalls.find(
          (r) => r.name === "propTool",
        ),
      ).toBeDefined();
      expect(
        capturedInstances[1]?.renderToolCalls.find(
          (r) => r.name === "hookTool",
        ),
      ).toBeDefined();
      expect(capturedInstances[1]).not.toBe(capturedInstances[0]);
      view2.unmount();
    });

    it("does not leak executing state from prior mount", async () => {
      let firstMountSize = -1;
      let secondMountSize = -1;

      const FirstMountChild = defineComponent({
        setup() {
          const context = useCopilotKit();
          context.executingToolCallIds.value = new Set(["leaked-tool-call-id"]);
          firstMountSize = context.executingToolCallIds.value.size;
          return () => null;
        },
      });

      const SecondMountChild = defineComponent({
        setup() {
          const context = useCopilotKit();
          secondMountSize = context.executingToolCallIds.value.size;
          return () => null;
        },
      });

      const view1 = renderProvider({
        child: FirstMountChild,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      view1.unmount();

      const view2 = renderProvider({
        child: SecondMountChild,
        runtimeUrl: "/api/copilotkit",
      });
      await nextTick();
      view2.unmount();

      expect(firstMountSize).toBe(1);
      expect(secondMountSize).toBe(0);
    });
  });

  describe("hook render entries survive prop changes", () => {
    it("preserves hook-registered render entries when provider renderToolCalls prop changes", async () => {
      let capturedInstance: CopilotKitCoreVue | null = null;
      const currentRenderToolCalls = ref<VueFrontendTool[]>([]);

      const DynamicRenderChild = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          capturedInstance = copilotkit.value;

          useFrontendTool(
            {
              name: "hookTool",
              description: "Registered via hook",
              parameters: z.object({ x: z.string() }),
              handler: async () => "ok",
              render: defineComponent({ template: "<div>Hook render</div>" }),
            },
            [currentRenderToolCalls],
          );

          return () => null;
        },
      });

      const rtc1: VueFrontendTool[] = [
        {
          name: "propToolA",
          description: "A",
          parameters: z.object({ a: z.string() }),
          render: defineComponent({ template: "<div>A</div>" }),
        },
      ];
      const rtc2: VueFrontendTool[] = [
        {
          name: "propToolB",
          description: "B",
          parameters: z.object({ b: z.string() }),
          render: defineComponent({ template: "<div>B</div>" }),
        },
      ];

      const view = renderProvider({
        child: DynamicRenderChild,
        runtimeUrl: "/api/copilotkit",
        frontendTools: rtc1,
      });

      currentRenderToolCalls.value = rtc2;
      await view.rerender({
        runtimeUrl: "/api/copilotkit",
        frontendTools: rtc2,
      });
      await nextTick();

      expect(capturedInstance).not.toBeNull();
      const renderToolCalls = capturedInstance!.renderToolCalls;
      expect(
        renderToolCalls.find((r) => r.name === "propToolA"),
      ).toBeUndefined();
      expect(renderToolCalls.find((r) => r.name === "propToolB")).toBeDefined();
      expect(renderToolCalls.find((r) => r.name === "hookTool")).toBeDefined();
    });
  });

  describe("runtimeUrl deduplication", () => {
    it("always calls setRuntimeUrl with the same URL on re-render (AgentRegistry deduplicates)", async () => {
      const setRuntimeUrlCalls: unknown[] = [];
      let spyAttached = false;

      const SpyAttacher = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          if (!spyAttached) {
            const original = copilotkit.value.setRuntimeUrl.bind(
              copilotkit.value,
            );
            copilotkit.value.setRuntimeUrl = (
              ...args: [string | undefined]
            ) => {
              setRuntimeUrlCalls.push(args[0]);
              return original(...args);
            };
            spyAttached = true;
          }
          return () => null;
        },
      });

      const view = renderProvider({
        child: SpyAttacher,
        runtimeUrl: "http://localhost:3000/api",
      });

      await view.rerender({ runtimeUrl: "http://localhost:3000/api" });
      await nextTick();

      expect(setRuntimeUrlCalls.length).toBeGreaterThanOrEqual(1);
      for (const url of setRuntimeUrlCalls) {
        expect(url).toBe("http://localhost:3000/api");
      }
    });
  });
});
