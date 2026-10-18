import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import type { Attachment } from "@copilotkit/shared";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import type { CopilotChatLabels } from "../../../providers/types";
import CopilotChatReasoningMessage from "../CopilotChatReasoningMessage.vue";
import CopilotChatAttachmentQueue from "../CopilotChatAttachmentQueue.vue";
import CopilotChatInput from "../CopilotChatInput.vue";
import { CopilotModalHeader, CopilotSidebarView } from "../index";

// Strings an app translates through `labels`. Every one of them used to be
// hard-coded English.
const germanLabels: Partial<Record<keyof CopilotChatLabels, string>> = {
  reasoningMessageThinkingLabel: "Denkt nach…",
  chatInputSlashMenuLabel: "Befehle",
  chatInputSlashMenuEmptyText: "Keine Befehle gefunden",
  attachmentRemoveButtonLabel: "Anhang entfernen",
  attachmentPlayVideoButtonLabel: "Video abspielen",
  attachmentPreviewCloseButtonLabel: "Vorschau schließen",
  modalHeaderCloseButtonLabel: "Schließen",
  modalHeaderThreadsButtonLabel: "Unterhaltungen öffnen",
  sidebarLabel: "Chat-Seitenleiste",
};

function mountWithLabels(child: () => ReturnType<typeof h>) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "thread-1", labels: germanLabels },
          { default: child },
        ),
    },
  });
}

const reasoning = {
  id: "reasoning-1",
  role: "reasoning",
  content: "",
} as ReasoningMessage;

const video: Attachment = {
  id: "clip",
  type: "video",
  source: { type: "data", value: "AAAA", mimeType: "video/mp4" },
  filename: "clip.mp4",
  status: "ready",
};

describe("chat strings from labels", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the configured reasoning label while the model reasons", () => {
    const wrapper = mountWithLabels(() =>
      h(CopilotChatReasoningMessage, {
        message: reasoning,
        messages: [reasoning] as Message[],
        isRunning: true,
      }),
    );

    expect(wrapper.text()).toContain("Denkt nach…");
    expect(wrapper.text()).not.toContain("Thinking…");
  });

  it("passes the elapsed reasoning time to the header slot", async () => {
    vi.useFakeTimers();
    const wrapper = mountWithLabels(() =>
      h(
        CopilotChatReasoningMessage,
        {
          message: reasoning,
          messages: [reasoning] as Message[],
          isRunning: true,
        },
        {
          header: ({ elapsedSeconds }: { elapsedSeconds: number }) =>
            h("span", `${Math.round(elapsedSeconds)} Sekunden`),
        },
      ),
    );

    expect(wrapper.text()).toContain("0 Sekunden");
    vi.advanceTimersByTime(3000);
    await nextTick();
    expect(wrapper.text()).toContain("3 Sekunden");
  });

  it("names the slash-command menu and its empty state", async () => {
    const wrapper = mountWithLabels(() =>
      h(CopilotChatInput, {
        modelValue: "/zzz",
        toolsMenu: [{ label: "Say hi", action: vi.fn() }],
      }),
    );
    await wrapper.get("textarea").trigger("input");
    await nextTick();

    const menu = wrapper.get("[data-testid='copilot-slash-menu']");
    expect(menu.attributes("aria-label")).toBe("Befehle");
    expect(menu.text()).toContain("Keine Befehle gefunden");
  });

  it("names the attachment queue buttons and the preview close button", async () => {
    const wrapper = mountWithLabels(() =>
      h(CopilotChatAttachmentQueue, { attachments: [video] }),
    );

    expect(wrapper.find("[aria-label='Anhang entfernen']").exists()).toBe(true);
    await wrapper.get("[aria-label='Video abspielen']").trigger("click");
    expect(
      document.body.querySelector("[aria-label='Vorschau schließen']"),
    ).not.toBeNull();
    wrapper.unmount();
  });

  it("names the modal header close and threads buttons", async () => {
    // A mobile viewport: the threads launcher only renders there.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        media: "(max-width: 767px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
    let config!: ReturnType<typeof useCopilotChatConfiguration>;
    const Probe = defineComponent({
      setup() {
        config = useCopilotChatConfiguration();
        return () => null;
      },
    });

    const wrapper = mountWithLabels(() => [h(CopilotModalHeader), h(Probe)]);
    config.value?.registerDrawer();
    await nextTick();

    expect(
      wrapper.get("[data-testid='drawer-launcher']").attributes("aria-label"),
    ).toBe("Unterhaltungen öffnen");
    expect(wrapper.find("[aria-label='Schließen']").exists()).toBe(true);
  });

  it("names the sidebar", () => {
    const wrapper = mountWithLabels(() => h(CopilotSidebarView, {}));

    expect(wrapper.get("[data-copilot-sidebar]").attributes("aria-label")).toBe(
      "Chat-Seitenleiste",
    );
  });
});
