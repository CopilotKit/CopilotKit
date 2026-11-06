import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { z } from "zod-v3";
import { Catalog } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
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

  it("keeps the built-in render_a2ui renderer and the app's renderers together when the app's renderers change", async () => {
    const catalog = { id: "test", components: new Map() };
    const weather = { name: "weather", args: z.any(), render: () => null };
    const { wrapper, observedCore } = mountProvider({
      a2ui: { catalog },
      renderToolCalls: [weather],
    });
    const names = () =>
      observedCore.value?.renderToolCalls.map((renderer) => renderer.name);
    expect(names()).toEqual(["weather", "render_a2ui"]);

    await wrapper.setProps({
      renderToolCalls: [weather, { ...weather, name: "search" }],
    });

    expect(names()).toEqual(["weather", "search", "render_a2ui"]);
  });

  it("does not register an a2ui-surface renderer when no catalog is provided and runtime has not signaled a2uiEnabled", () => {
    const { observedCore } = mountProvider({ a2ui: { theme: {} } });

    const a2uiRenderer = observedCore.value?.renderActivityMessages.find(
      (r) => r.activityType === "a2ui-surface",
    );
    expect(a2uiRenderer).toBeUndefined();
  });
});

const CAPABILITIES_DESCRIPTION =
  "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.";

function makeCustomCatalog(): Catalog<ComponentApi> {
  return new Catalog<ComponentApi>(
    "copilotkit://custom-catalog",
    [{ name: "FlightCard", schema: z.object({ airline: z.string() }) }],
    [],
  );
}

function capabilitiesValue(
  core: ReturnType<typeof mountProvider>["observedCore"]["value"],
): string | undefined {
  return Object.values(core?.context ?? {}).find(
    (entry) => entry.description === CAPABILITIES_DESCRIPTION,
  )?.value;
}

describe("CopilotKitProvider a2ui catalog context", () => {
  it("lists custom components by name only when includeSchema is false", () => {
    const { observedCore } = mountProvider({
      a2ui: { catalog: makeCustomCatalog(), includeSchema: false },
    });

    expect(capabilitiesValue(observedCore.value)).toBe(
      [
        "Available A2UI catalog:",
        "- copilotkit://custom-catalog",
        "  Custom catalog (does NOT include all basic components).",
        "  Custom components:",
        "  - FlightCard",
      ].join("\n"),
    );
  });

  it("includes custom component schemas by default", () => {
    const { observedCore } = mountProvider({
      a2ui: { catalog: makeCustomCatalog() },
    });

    const value = capabilitiesValue(observedCore.value);
    expect(value).toContain("  - FlightCard:\n    {");
    expect(value).toContain('"airline"');
  });

  it("registers the catalog's components with core for the Inspector", () => {
    const { observedCore } = mountProvider({
      a2ui: { catalog: makeCustomCatalog() },
    });
    expect(
      observedCore.value?.catalogComponents.map((component) => component.name),
    ).toEqual(["FlightCard"]);
  });

  it("stops advertising a component the Inspector disables", async () => {
    const { observedCore } = mountProvider({
      a2ui: { catalog: makeCustomCatalog() },
    });
    observedCore.value?.setCatalogComponentEnabled("FlightCard", false);
    await nextTick();
    expect(capabilitiesValue(observedCore.value)).not.toContain("FlightCard");
  });
});
