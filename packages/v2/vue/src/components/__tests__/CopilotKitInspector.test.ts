import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { defineWebInspector } from "@copilotkitnext/web-inspector";
import CopilotKitInspector from "../CopilotKitInspector.vue";
import { CopilotKitCoreVue } from "../../lib/vue-core";

async function settleInspectorLoad() {
  await nextTick();
  await vi.dynamicImportSettled();
  await nextTick();
}

describe("CopilotKitInspector", () => {
  beforeEach(() => {
    vi.mocked(defineWebInspector).mockClear();
  });

  it("renders nothing until the web inspector module resolves", async () => {
    const wrapper = mount(CopilotKitInspector);

    expect(wrapper.html()).toBe("<!--v-if-->");

    await settleInspectorLoad();

    expect(wrapper.find("cpk-web-inspector").exists()).toBe(true);
    expect(defineWebInspector).toHaveBeenCalledTimes(1);
  });

  it("forwards core and arbitrary attributes to the web inspector element", async () => {
    const core = new CopilotKitCoreVue({
      runtimeUrl: "/api/copilotkit",
    });

    const wrapper = mount(CopilotKitInspector, {
      props: {
        core,
      },
      attrs: {
        "data-testid": "inspector",
        "data-surface": "storybook",
      },
    });

    await settleInspectorLoad();

    const inspector = wrapper.get("cpk-web-inspector");
    const resolvedCore = (
      inspector.element as HTMLElement & { core?: CopilotKitCoreVue }
    ).core;

    expect(inspector.attributes("data-testid")).toBe("inspector");
    expect(inspector.attributes("data-surface")).toBe("storybook");
    expect(resolvedCore).toBeInstanceOf(CopilotKitCoreVue);
    expect(resolvedCore?.runtimeUrl).toBe("/api/copilotkit");
  });
});
