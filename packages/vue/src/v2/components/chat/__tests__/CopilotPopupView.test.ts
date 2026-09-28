import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import {
  CopilotPopupView,
  CopilotPopupView as NamespacedPopupView,
} from "../index";

function mountPopupView(
  props: Record<string, unknown> = {},
  slots: Parameters<typeof h>[2] = {},
) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () => h(CopilotPopupView, props, slots),
    },
  });
}

describe("CopilotPopupView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders open by default and applies width and height CSS variables", async () => {
    const wrapper = mountPopupView({
      width: 500,
      height: 700,
    });

    await nextTick();

    const popup = wrapper.get("[data-copilot-popup]");
    expect(popup.attributes("style")).toContain("--copilot-popup-width: 500px");
    expect(popup.attributes("style")).toContain(
      "--copilot-popup-height: 700px",
    );
  });

  it("stays hidden when defaultOpen is false", async () => {
    const wrapper = mountPopupView({
      defaultOpen: false,
    });

    await nextTick();
    expect(wrapper.find("[data-copilot-popup]").exists()).toBe(false);
    expect(wrapper.find("[data-slot='chat-toggle-button']").exists()).toBe(
      true,
    );
  });

  it("only exposes stop capability when an onStop callback is available", async () => {
    const withoutStop = mountPopupView(
      {},
      {
        "welcome-screen": ({ canStop }: { canStop: boolean }) =>
          h("div", { "data-testid": "popup-can-stop" }, String(canStop)),
      },
    );

    expect(withoutStop.get("[data-testid='popup-can-stop']").text()).toBe(
      "false",
    );

    const onStop = vi.fn();
    const withStop = mountPopupView(
      { onStop },
      {
        "welcome-screen": ({
          canStop,
          onStop: stop,
        }: {
          canStop: boolean;
          onStop: () => void;
        }) =>
          h(
            "button",
            { "data-testid": "popup-stop", onClick: stop },
            String(canStop),
          ),
      },
    );

    expect(withStop.get("[data-testid='popup-stop']").text()).toBe("true");
    await withStop.get("[data-testid='popup-stop']").trigger("click");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("closes on escape and outside pointerdown when enabled", async () => {
    const wrapper = mountPopupView({
      clickOutsideToClose: true,
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    vi.advanceTimersByTime(200);
    await nextTick();

    expect(wrapper.find("[data-copilot-popup]").exists()).toBe(false);

    const reopened = mountPopupView({
      clickOutsideToClose: true,
    });
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    vi.advanceTimersByTime(200);
    await nextTick();

    expect(reopened.find("[data-copilot-popup]").exists()).toBe(false);
  });

  it("ignores outside-close detection when the toggle button is clicked and supports custom slots", async () => {
    const wrapper = mountPopupView(
      {
        clickOutsideToClose: true,
      },
      {
        header: ({ title }: { title: string }) =>
          h("div", { "data-testid": "custom-header" }, title),
        "toggle-button": ({ toggle }: { toggle: () => void }) =>
          h(
            "button",
            { "data-testid": "custom-toggle", onClick: toggle },
            "toggle",
          ),
      },
    );

    await wrapper.get("[data-testid='custom-toggle']").trigger("click");
    await nextTick();
    vi.advanceTimersByTime(200);
    await nextTick();

    expect(wrapper.find("[data-copilot-popup]").exists()).toBe(false);
    await wrapper.get("[data-testid='custom-toggle']").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid='custom-header']").exists()).toBe(true);
  });

  it("exposes the WelcomeScreen namespaced export", () => {
    expect(NamespacedPopupView.WelcomeScreen).toBeDefined();
  });

  it("passes capability flags through the namespaced WelcomeScreen input slot", () => {
    const wrapper = mount(NamespacedPopupView.WelcomeScreen, {
      props: {
        suggestions: [],
        loadingIndexes: [],
        modelValue: "",
        isRunning: false,
        inputMode: "input",
        inputToolsMenu: [],
        canStop: false,
        canAddFile: false,
        canTranscribe: false,
        onUpdateModelValue: vi.fn(),
        onSubmitMessage: vi.fn(),
        onStop: vi.fn(),
        onAddFile: vi.fn(),
        onStartTranscribe: vi.fn(),
        onSelectSuggestion: vi.fn(),
      },
      slots: {
        input: ({
          canStop,
          canAddFile,
          canTranscribe,
        }: {
          canStop: boolean;
          canAddFile: boolean;
          canTranscribe: boolean;
        }) =>
          h(
            "div",
            { "data-testid": "popup-welcome-capabilities" },
            `${canStop}:${canAddFile}:${canTranscribe}`,
          ),
      },
    });

    expect(
      wrapper.get("[data-testid='popup-welcome-capabilities']").text(),
    ).toBe("false:false:false");
  });
});
