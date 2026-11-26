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
// Every registration ever made, including ones that were later removed.
let registerCalls: string[];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  registered = new Map();
  registerCalls = [];
  (document as Document & { modelContext?: unknown }).modelContext = {
    registerTool: vi.fn(
      async (tool: { name: string }, options: { signal: AbortSignal }) => {
        registerCalls.push(tool.name);
        // Like the real API, a duplicate name rejects.
        if (registered.has(tool.name)) {
          throw new DOMException("duplicate", "InvalidStateError");
        }
        registered.set(tool.name, tool);
        options.signal.addEventListener("abort", () => {
          if (registered.get(tool.name) === tool) {
            registered.delete(tool.name);
          }
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
    // Never registered, not registered and then removed.
    expect(registerCalls).not.toContain("searchOrders");
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

  it("removes every registration when the provider unmounts", () => {
    const { wrapper } = mountProvider(CopilotKitProvider, {
      frontendTools: [
        {
          name: "providerTool",
          description: "Passed to the provider",
          handler: async () => "ok",
        },
      ],
    });
    expect([...registered.keys()].sort()).toEqual([
      "providerTool",
      "searchOrders",
    ]);

    wrapper.unmount();

    expect(registered.size).toBe(0);
  });

  it("registers the replacement's tools when a keyed provider is replaced", async () => {
    // Provider tools register during the replacement's setup, before Vue runs
    // the old provider's unmounted hooks.
    const frontendTools = [
      {
        name: "providerTool",
        description: "Passed to the provider",
        handler: async () => "ok",
      },
    ];
    const Host = defineComponent({
      props: { providerKey: { type: String, required: true } },
      setup(hostProps) {
        return () =>
          h(CopilotKitProvider, { key: hostProps.providerKey, frontendTools });
      },
    });
    const wrapper = mount(Host, { props: { providerKey: "a" } });
    expect(registered.has("providerTool")).toBe(true);

    await wrapper.setProps({ providerKey: "b" });
    await nextTick();
    // Let a rejected registration settle, if there was one.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(registered.has("providerTool")).toBe(true);
    expect(
      registerCalls.filter((name) => name === "providerTool"),
    ).toHaveLength(2);
  });
});
