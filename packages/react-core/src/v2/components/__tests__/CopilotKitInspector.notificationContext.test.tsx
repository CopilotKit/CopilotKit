import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { configureWebInspectorElement } from "@copilotkit/web-inspector";
import packageInfo from "../../../../package.json";
import { CopilotKitInspector } from "../CopilotKitInspector";
vi.mock("@copilotkit/web-inspector", () => ({
  WEB_INSPECTOR_TAG: "cpk-notification-test",
  defineWebInspector: vi.fn(),
  configureWebInspectorElement: vi.fn((element) => element),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
test.each(["development", "production"])(
  "passes its package version and %s mode to notification targeting",
  async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    render(<CopilotKitInspector />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(configureWebInspectorElement).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      null,
      {
        development: environment === "development",
        framework: "react",
        sdkVersion: packageInfo.version,
      },
    );
  },
);
