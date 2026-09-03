import { describe, expect, it, vi } from "vitest";
import { getClientBaseUrl } from "./client-base-url";

const runtimeConfig = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(),
}));

vi.mock("@/lib/runtime-config.client", () => runtimeConfig);

describe("getClientBaseUrl", () => {
  it("strips a trailing slash so callers can concatenate a leading-slash path", () => {
    runtimeConfig.getRuntimeConfig.mockReturnValue({
      baseUrl: "https://docs.copilotkit.ai/",
    });
    expect(getClientBaseUrl()).toBe("https://docs.copilotkit.ai");
  });

  it("leaves a base URL with no trailing slash untouched", () => {
    runtimeConfig.getRuntimeConfig.mockReturnValue({
      baseUrl: "https://docs.copilotkit.ai",
    });
    expect(getClientBaseUrl()).toBe("https://docs.copilotkit.ai");
  });
});
