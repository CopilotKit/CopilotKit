import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { z } from "zod";
import type { CopilotKitCoreSubscriber } from "@copilotkit/core";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useRenderTool } from "../../hooks/use-render-tool";
import {
  RENDER_A2UI_TOOL_NAME,
  createA2UIToolCallRenderer,
} from "../A2UIToolCallRenderer";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import type { VueToolCallRenderer } from "../../types/vue-tool-call-renderer";

interface CopilotKitCoreTestAccess {
  notifySubscribers(
    handler: (subscriber: CopilotKitCoreSubscriber) => void | Promise<void>,
    errorMessage: string,
  ): Promise<void>;
}

/**
 * Simulates the runtime reporting A2UI as enabled.
 * This overrides the a2uiEnabled getter and fires the subscriber notification
 * that the provider listens to.
 */
async function enableA2UIOnCore(core: CopilotKitCoreVue): Promise<void> {
  Object.defineProperty(core, "a2uiEnabled", { get: () => true });
  await (core as unknown as CopilotKitCoreTestAccess).notifySubscribers(
    (sub) =>
      sub.onRuntimeConnectionStatusChanged?.({
        copilotkit: core,
        status: "connected" as never,
      }),
    "test: enable A2UI",
  );
  await nextTick();
}

function mountWithA2UI(
  providerProps: Record<string, unknown> = {},
  slotContent?: () => ReturnType<typeof h>,
) {
  let core: CopilotKitCoreVue | undefined;

  const Probe = defineComponent({
    setup() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit.value;
      return () => null;
    },
  });

  const wrapper = mount(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
      ...providerProps,
    },
    slots: {
      default: () => h("div", [slotContent?.() ?? null, h(Probe)]),
    },
  });

  return {
    wrapper,
    getCore: () => {
      if (!core) throw new Error("CopilotKit core not available");
      return core;
    },
  };
}

describe("A2UIToolCallRenderer", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("registration lifecycle", () => {
    it("includes built-in render_a2ui when A2UI is enabled at runtime", async () => {
      const { getCore } = mountWithA2UI({ a2ui: {} });
      const core = getCore();

      await enableA2UIOnCore(core);

      const names = core.propRenderToolCalls.map((rc) => rc.name);
      expect(names).toContain(RENDER_A2UI_TOOL_NAME);
    });

    it("does not include built-in render_a2ui when A2UI is not enabled", () => {
      const { getCore } = mountWithA2UI({ a2ui: {} });
      const core = getCore();

      const names = core.propRenderToolCalls.map((rc) => rc.name);
      expect(names).not.toContain(RENDER_A2UI_TOOL_NAME);
    });

    it("includes built-in even without a2ui prop when runtime reports A2UI enabled", async () => {
      // runtimeA2UIEnabled is the sole gate — if the runtime says A2UI is on,
      // the built-in renderer is included regardless of a2ui prop presence.
      const { getCore } = mountWithA2UI({});
      const core = getCore();

      await enableA2UIOnCore(core);

      const names = core.propRenderToolCalls.map((rc) => rc.name);
      expect(names).toContain(RENDER_A2UI_TOOL_NAME);
    });

    it("built-in survives when provider frontendTools change", async () => {
      const { wrapper, getCore } = mountWithA2UI({
        a2ui: {},
        frontendTools: [],
      });
      const core = getCore();

      await enableA2UIOnCore(core);
      expect(core.propRenderToolCalls.map((rc) => rc.name)).toContain(
        RENDER_A2UI_TOOL_NAME,
      );

      // Simulate adding a new frontendTool with a render function
      await wrapper.setProps({
        frontendTools: [
          {
            name: "myTool",
            parameters: z.object({ x: z.string() }),
            handler: async () => "ok",
            render: () => h("div", "custom tool render"),
          },
        ],
      });
      await nextTick();

      const names = core.propRenderToolCalls.map((rc) => rc.name);
      expect(names).toContain(RENDER_A2UI_TOOL_NAME);
      expect(names).toContain("myTool");
    });

    it("provider renderToolCalls with render_a2ui suppresses built-in", async () => {
      const userRenderFn = () => h("div", "custom a2ui renderer");
      const userRenderer: VueToolCallRenderer<unknown> = {
        name: RENDER_A2UI_TOOL_NAME,
        args: z.any(),
        render: userRenderFn,
      };

      const { getCore } = mountWithA2UI({
        a2ui: {},
        renderToolCalls: [userRenderer],
      });
      const core = getCore();

      await enableA2UIOnCore(core);

      const renderers = core.propRenderToolCalls.filter(
        (rc) => rc.name === RENDER_A2UI_TOOL_NAME,
      );
      // Only the user-provided renderer should be present, not the built-in
      expect(renderers).toHaveLength(1);
      // Vue proxies props, so check the render function identity instead of object identity
      expect(renderers[0].render).toBe(userRenderFn);
    });

    it("hook useRenderTool overrides built-in via merge logic", async () => {
      let hookRendererCalled = false;

      const HookChild = defineComponent({
        setup() {
          useRenderTool({
            name: RENDER_A2UI_TOOL_NAME,
            args: z.any(),
            render: () => {
              hookRendererCalled = true;
              return h("div", "hook-override");
            },
          });
          return () => null;
        },
      });

      const { getCore } = mountWithA2UI({ a2ui: {} }, () => h(HookChild));
      const core = getCore();

      await enableA2UIOnCore(core);

      // prop-based still has the built-in
      expect(core.propRenderToolCalls.map((rc) => rc.name)).toContain(
        RENDER_A2UI_TOOL_NAME,
      );

      // merged renderToolCalls should contain hook version (hook wins)
      const mergedRenderers = core.renderToolCalls.filter(
        (rc) => rc.name === RENDER_A2UI_TOOL_NAME,
      );
      expect(mergedRenderers).toHaveLength(1);

      // Verify the hook renderer is the one that runs
      mergedRenderers[0].render({
        name: RENDER_A2UI_TOOL_NAME,
        toolCallId: "tc-1",
        args: {},
        status: "inProgress" as never,
        result: undefined,
      } as never);
      expect(hookRendererCalled).toBe(true);
    });
  });

  describe("factory", () => {
    it("returns a stable singleton renderer", () => {
      const a = createA2UIToolCallRenderer();
      const b = createA2UIToolCallRenderer();
      expect(a).toBe(b);
    });

    it("renderer has correct name", () => {
      const renderer = createA2UIToolCallRenderer();
      expect(renderer.name).toBe(RENDER_A2UI_TOOL_NAME);
    });

    it("renderer returns null for complete status", () => {
      const renderer = createA2UIToolCallRenderer();
      const result = (renderer.render as Function)({
        name: RENDER_A2UI_TOOL_NAME,
        toolCallId: "tc-1",
        args: {},
        status: "complete",
        result: "done",
      });
      expect(result).toBeNull();
    });
  });
});
