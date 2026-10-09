import packageInfo from "../../../../package.json";
import { afterEach, expect, test, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { configureWebInspectorElement } from "@copilotkit/web-inspector";
import CopilotKitInspector from "../CopilotKitInspector.vue";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test.each(["development", "production"])(
  "passes its package version and %s mode to notification targeting",
  async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    const wrapper = mount(CopilotKitInspector);
    try {
      await nextTick();
      await vi.dynamicImportSettled();
      await nextTick();
      expect(configureWebInspectorElement).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        null,
        {
          development: environment === "development",
          framework: "vue",
          sdkVersion: packageInfo.version,
        },
        { defaultAnchor: undefined },
      );
    } finally {
      wrapper.unmount();
    }
  },
);

test("passes the default anchor and follows later changes", async () => {
  const wrapper = mount(CopilotKitInspector, {
    props: { defaultAnchor: { horizontal: "left", vertical: "bottom" } },
  });
  try {
    await nextTick();
    await vi.dynamicImportSettled();
    await nextTick();
    expect(configureWebInspectorElement).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      null,
      expect.any(Object),
      { defaultAnchor: { horizontal: "left", vertical: "bottom" } },
    );

    await wrapper.setProps({
      defaultAnchor: { horizontal: "left", vertical: "top" },
    });
    const inspector = wrapper.find("cpk-web-inspector")
      .element as HTMLElement & {
      defaultAnchor?: unknown;
    };
    expect(inspector.defaultAnchor).toEqual({
      horizontal: "left",
      vertical: "top",
    });
  } finally {
    wrapper.unmount();
  }
});
