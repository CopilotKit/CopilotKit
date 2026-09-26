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
      );
    } finally {
      wrapper.unmount();
    }
  },
);
