import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../CopilotKitProvider.vue";

/** The removal warnings among the calls of a `console.warn` spy. */
function removalWarnings(warn: { mock: { calls: unknown[][] } }) {
  return warn.mock.calls
    .map(([message]) => message)
    .filter(
      (message) =>
        typeof message === "string" &&
        message.includes("was removed in CopilotKit 2.0."),
    );
}

afterEach(() => vi.restoreAllMocks());

// Core tests which props throw and which warn (ɵcheckRemovedProviderProps).
// These tests pin that the provider checks the props that it gets.
describe("CopilotKitProvider (Vue) with the props of the 1.x <CopilotKit>", () => {
  it("throws the removal error for a prop that cannot work in 2.0", () => {
    // Vue warns about the error of a setup before it throws the error.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() =>
      mount(CopilotKitProvider, { props: { threadId: "thread-1" } }),
    ).toThrow(
      expect.objectContaining({
        code: "REMOVED_API",
        message: expect.stringContaining(
          'The "threadId" prop of CopilotKit was removed in CopilotKit 2.0.',
        ),
      }),
    );
  });

  it("renders, and warns once, for a prop that 2.0 ignores", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const wrapper = mount(CopilotKitProvider, {
      props: { showDevConsole: true },
      slots: { default: () => h("p", "chat") },
    });
    await wrapper.setProps({ showDevConsole: false });

    expect(wrapper.text()).toBe("chat");
    expect(removalWarnings(warn)).toEqual([
      'The "showDevConsole" prop of CopilotKit was removed in CopilotKit 2.0. Delete it. To turn the Inspector on or off, set enableInspector. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#showdevconsole',
    ]);
  });

  it("renders the props of 2.0 without a removal warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const wrapper = mount(CopilotKitProvider, {
      props: {
        headers: { Authorization: "Bearer token" },
        properties: { userId: "user-1" },
      },
      slots: { default: () => h("p", "chat") },
    });

    expect(wrapper.text()).toBe("chat");
    expect(removalWarnings(warn)).toEqual([]);
  });
});
