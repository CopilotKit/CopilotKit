import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { Message } from "@ag-ui/core";
import type { Suggestion } from "@copilotkitnext/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { CopilotSidebarView } from "../index";

const messages: Message[] = [
  {
    id: "sidebar-user",
    role: "user",
    content: "Hello from the sidebar",
    timestamp: new Date(),
  },
];

const suggestions: Suggestion[] = [
  { title: "Summarize", message: "Summarize", isLoading: false },
];

const originalResizeObserver = globalThis.ResizeObserver;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

function mountSidebarView(props: Record<string, unknown> = {}, slots: Parameters<typeof h>[2] = {}) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () => h(CopilotSidebarView, props, slots),
    },
  });
}

describe("CopilotSidebarView", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        private callback: ResizeObserverCallback;

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }

        observe() {
          this.callback([], this as unknown as ResizeObserver);
        }

        disconnect() {}
      },
    );

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return {
        width: 612,
        height: 400,
        top: 0,
        left: 0,
        bottom: 400,
        right: 612,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      // @ts-expect-error test cleanup for missing ResizeObserver
      delete globalThis.ResizeObserver;
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("opens by default and applies measured body margin when width is not provided", async () => {
    const wrapper = mountSidebarView();
    await nextTick();
    await nextTick();

    const sidebar = wrapper.get("[data-copilot-sidebar]");
    expect(sidebar.attributes("aria-hidden")).toBe("false");
    expect(sidebar.attributes("style")).toContain("--sidebar-width: 612px");
    expect(wrapper.html()).toContain("margin-inline-end: 612px");
  });

  it("applies explicit width and renders default header and toggle button", () => {
    const wrapper = mountSidebarView({
      width: 520,
    });

    expect(wrapper.get("[data-copilot-sidebar]").attributes("style")).toContain("--sidebar-width: 520px");
    expect(wrapper.find("[data-slot='copilot-modal-header']").exists()).toBe(true);
    expect(wrapper.find("[data-slot='chat-toggle-button']").exists()).toBe(true);
  });

  it("replaces default header and toggle button via slots", () => {
    const wrapper = mountSidebarView(
      {},
      {
        header: ({ title }: { title: string }) =>
          h("div", { "data-testid": "custom-header" }, title),
        "toggle-button": ({ toggle }: { toggle: () => void }) =>
          h("button", { "data-testid": "custom-toggle", onClick: toggle }, "toggle"),
      },
    );

    expect(wrapper.find("[data-testid='custom-header']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='custom-toggle']").exists()).toBe(true);
    expect(wrapper.find("[data-slot='copilot-modal-header']").exists()).toBe(false);
  });

  it("forwards chat view slots and emitted interactions", async () => {
    const onSelectSuggestion = vi.fn();
    const wrapper = mountSidebarView(
      {
        messages,
        suggestions,
        onSelectSuggestion,
      },
      {
        "message-view": ({ messages: slotMessages }: { messages: Message[] }) =>
          h("div", { "data-testid": "custom-message-view" }, String(slotMessages.length)),
      },
    );

    expect(wrapper.get("[data-testid='custom-message-view']").text()).toBe("1");
    await wrapper.get("[data-testid='copilot-chat-suggestion-pill']").trigger("click");
    expect(onSelectSuggestion).toHaveBeenCalledTimes(1);
  });

  it("uses the default chat welcome screen and still forwards welcome sub-slots", () => {
    const wrapper = mountSidebarView(
      {
        messages: [],
        suggestions,
      },
      {
        "welcome-message": () => h("div", { "data-testid": "custom-welcome-message" }, "Hello"),
      },
    );

    expect(wrapper.find("[data-testid='copilot-sidebar-welcome-screen']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='copilot-chat-view-welcome-screen']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='custom-welcome-message']").text()).toBe("Hello");
  });

  it("exposes the WelcomeScreen namespaced export", () => {
    expect(CopilotSidebarView.WelcomeScreen).toBeDefined();
  });

  it("renders the namespaced WelcomeScreen component when used explicitly", () => {
    const wrapper = mount(CopilotSidebarView.WelcomeScreen, {
      props: {
        suggestions,
        loadingIndexes: [],
        modelValue: "",
        isRunning: false,
        inputMode: "input",
        inputToolsMenu: [],
        onUpdateModelValue: vi.fn(),
        onSubmitMessage: vi.fn(),
        onStop: vi.fn(),
        onSelectSuggestion: vi.fn(),
      },
      slots: {
        "welcome-message": () => h("div", { "data-testid": "sidebar-welcome-message" }, "Hello"),
      },
    });

    expect(wrapper.find("[data-testid='copilot-sidebar-welcome-screen']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='sidebar-welcome-message']").text()).toBe("Hello");
  });
});
