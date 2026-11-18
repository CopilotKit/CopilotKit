import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import type { Component } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import { useFrontendTool } from "../use-frontend-tool";
import { useHumanInTheLoop } from "../use-human-in-the-loop";

/** A 1.x `Parameter[]` list. */
const PARAMETER_LIST = [{ name: "city", type: "string", required: true }];

/** A component whose setup runs `setup`. */
function componentThatRuns(setup: () => void) {
  return defineComponent({
    setup() {
      setup();
      return () => null;
    },
  });
}

/** Mounts `component` in a provider with no runtime, so that nothing fetches. */
function mountInProvider(component: Component) {
  return mount(CopilotKitProvider, { slots: { default: () => h(component) } });
}

/** A `CopilotKitRemovedApiError` whose message contains `message`. */
function removalError(message: string) {
  return expect.objectContaining({
    name: "CopilotKitRemovedApiError",
    code: "REMOVED_API",
    message: expect.stringContaining(message),
  });
}

beforeEach(() => {
  // Vue warns about the error of a setup before it throws the error.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("useFrontendTool and useHumanInTheLoop with a Parameter[] list", () => {
  it("useFrontendTool throws the removal error", () => {
    const ToolUser = componentThatRuns(() =>
      useFrontendTool({ name: "getWeather", parameters: PARAMETER_LIST }),
    );

    expect(() => mountInProvider(ToolUser)).toThrow(
      removalError(
        'A Parameter[] list in "parameters" of useFrontendTool was removed in CopilotKit 2.0.',
      ),
    );
  });

  it("useHumanInTheLoop throws the removal error", () => {
    const ToolUser = componentThatRuns(() =>
      useHumanInTheLoop({
        name: "confirmBooking",
        parameters: PARAMETER_LIST,
        render: () => null,
      }),
    );

    expect(() => mountInProvider(ToolUser)).toThrow(
      removalError(
        'A Parameter[] list in "parameters" of useHumanInTheLoop was removed in CopilotKit 2.0.',
      ),
    );
  });
});
