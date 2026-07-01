import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { useCopilotKit } from "../useCopilotKit";

function mountProvider(props: Record<string, unknown>) {
  const observedCore =
    ref<ReturnType<typeof useCopilotKit>["copilotkit"]["value"]>();

  const Child = defineComponent({
    setup() {
      const { copilotkit } = useCopilotKit();
      observedCore.value = copilotkit.value;
      return () => h("div");
    },
  });

  const wrapper = mount(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
      ...props,
    },
    slots: {
      default: () => h(Child),
    },
  });

  return { wrapper, observedCore };
}

describe("CopilotKitProvider a2ui catalog auto-enable", () => {
  it("forwards a2uiCatalogAvailable when a catalog is passed to the provider", () => {
    const { observedCore } = mountProvider({
      a2ui: { catalog: { id: "test", components: new Map() } },
    });

    expect(observedCore.value?.properties.a2uiCatalogAvailable).toBe(true);
  });

  it("does not forward a2uiCatalogAvailable when no catalog is passed", () => {
    const { observedCore } = mountProvider({ a2ui: {} });

    expect(observedCore.value?.properties.a2uiCatalogAvailable).toBeUndefined();
  });

  it("preserves user-provided properties alongside the catalog signal", () => {
    const { observedCore } = mountProvider({
      a2ui: { catalog: { id: "test", components: new Map() } },
      properties: { tenant: "acme" },
    });

    expect(observedCore.value?.properties).toMatchObject({
      tenant: "acme",
      a2uiCatalogAvailable: true,
    });
  });

  it("registers an a2ui-surface renderer when a catalog is provided, without a runtime signal", () => {
    const { observedCore } = mountProvider({
      a2ui: { catalog: { id: "test", components: new Map() } },
    });

    const a2uiRenderer = observedCore.value?.renderActivityMessages.find(
      (r) => r.activityType === "a2ui-surface",
    );
    expect(a2uiRenderer).toBeDefined();
  });

  it("does not register an a2ui-surface renderer when no catalog is provided and runtime has not signaled a2uiEnabled", () => {
    const { observedCore } = mountProvider({ a2ui: { theme: {} } });

    const a2uiRenderer = observedCore.value?.renderActivityMessages.find(
      (r) => r.activityType === "a2ui-surface",
    );
    expect(a2uiRenderer).toBeUndefined();
  });
});
