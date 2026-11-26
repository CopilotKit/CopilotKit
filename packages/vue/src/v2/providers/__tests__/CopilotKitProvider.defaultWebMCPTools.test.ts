import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import CopilotKit from "../../../components/copilot-provider/CopilotKit.vue";
import { useCopilotKit } from "../useCopilotKit";
import { useFrontendTool } from "../../hooks/use-frontend-tool";
import type { CopilotKitCoreVue } from "../../lib/vue-core";

/**
 * The `defaultWebMCPTools` prop. The registration rules themselves are tested
 * in `packages/core/src/core/__tests__/run-handler-webmcp.test.ts`; these
 * assert that the prop reaches the core, including Vue's boolean-prop casting
 * (an absent boolean prop is `false` unless it has a default).
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

function mountProvider(
  provider: typeof CopilotKitProvider | typeof CopilotKit,
  props: Record<string, unknown> = {},
) {
  let core: CopilotKitCoreVue | undefined;
  const Tool = defineComponent({
    setup() {
      core = useCopilotKit().copilotkit.value;
      useFrontendTool({
        name: "searchOrders",
        description: "Search the user's orders",
        handler: async () => "[]",
      });
      return () => null;
    },
  });
  const wrapper = mount(provider as typeof CopilotKitProvider, {
    props,
    slots: { default: () => h(Tool) },
  });
  return { wrapper, getCore: () => core! };
}

describe("CopilotKitProvider defaultWebMCPTools", () => {
  it("exposes tools without a webmcp flag by default", () => {
    const { getCore } = mountProvider(CopilotKitProvider);

    expect(getCore().defaultWebMCPTools).toBe(true);
    expect(registered.has("searchOrders")).toBe(true);
  });

  it("keeps the default on through the v1 CopilotKit wrapper", () => {
    const { getCore } = mountProvider(CopilotKit);

    expect(getCore().defaultWebMCPTools).toBe(true);
    expect(registered.has("searchOrders")).toBe(true);
  });

  it("only exposes opted-in tools when set to false", () => {
    const { getCore } = mountProvider(CopilotKitProvider, {
      defaultWebMCPTools: false,
    });

    expect(getCore().defaultWebMCPTools).toBe(false);
    expect(registered.has("searchOrders")).toBe(false);
  });

  it("follows later prop changes", async () => {
    const { wrapper, getCore } = mountProvider(CopilotKitProvider, {
      defaultWebMCPTools: false,
    });

    await wrapper.setProps({ defaultWebMCPTools: true });
    await nextTick();
    expect(getCore().defaultWebMCPTools).toBe(true);
    expect(registered.has("searchOrders")).toBe(true);
  });
});
