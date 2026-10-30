import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, onMounted } from "vue";
import { fireEvent, render, screen } from "@testing-library/vue";
import type { ReasoningMessage } from "@ag-ui/core";
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
  reasoningMessageThoughtForLabel: "Gedacht für {duration}",
  reasoningMessageDurationFewSeconds: "ein paar Sekunden",
  chatInputSlashMenuLabel: "Befehle",
  chatInputSlashMenuEmptyText: "Keine Befehle gefunden",
  attachmentRemoveButtonLabel: "Anhang entfernen",
  attachmentPlayVideoButtonLabel: "Video abspielen",
  attachmentPreviewCloseButtonLabel: "Vorschau schließen",
  modalHeaderCloseButtonLabel: "Schließen",
  modalHeaderThreadsButtonLabel: "Unterhaltungen öffnen",
  sidebarLabel: "Chat-Seitenleiste",
};

const reasoning: ReasoningMessage = {
  id: "reasoning-1",
  role: "reasoning",
  content: "",
};

const video: Attachment = {
  id: "clip",
  type: "video",
  source: { type: "data", value: "AAAA", mimeType: "video/mp4" },
  filename: "clip.mp4",
  status: "ready",
};

/** Registers a threads drawer, which the header needs before it shows its launcher. */
const DrawerRegistrar = defineComponent({
  setup() {
    const config = useCopilotChatConfiguration();
    onMounted(() => config.value?.registerDrawer());
  },
  template: `<span />`,
});

/** Renders `template` inside the providers, with the German labels configured. */
function renderWithLabels(template: string) {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatReasoningMessage,
      CopilotChatAttachmentQueue,
      CopilotChatInput,
      CopilotModalHeader,
      CopilotSidebarView,
      DrawerRegistrar,
    },
    setup() {
      return {
        labels: germanLabels,
        reasoning,
        reasoningMessages: [reasoning],
        attachments: [video],
        toolsMenu: [{ label: "Say hi", action: vi.fn() }],
      };
    },
    template: `
      <CopilotKitProvider runtime-url="/api/copilotkit">
        <CopilotChatConfigurationProvider thread-id="thread-1" :labels="labels">
          ${template}
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });
  return render(Host);
}

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
  });

  it("uses the configured reasoning label while the model reasons", () => {
    renderWithLabels(`
      <CopilotChatReasoningMessage
        :message="reasoning"
        :messages="reasoningMessages"
        :is-running="true"
      />
    `);

    expect(screen.getByText("Denkt nach…")).toBeDefined();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("uses the configured duration labels once the model is done", () => {
    renderWithLabels(`
      <CopilotChatReasoningMessage
        :message="reasoning"
        :messages="reasoningMessages"
        :is-running="false"
      />
    `);

    expect(screen.getByText("Gedacht für ein paar Sekunden")).toBeDefined();
    expect(screen.queryByText(/Thought for/)).toBeNull();
  });

  it("passes the elapsed reasoning time to a custom header", async () => {
    vi.useFakeTimers();
    renderWithLabels(`
      <CopilotChatReasoningMessage
        :message="reasoning"
        :messages="reasoningMessages"
        :is-running="true"
      >
        <template #header="{ elapsedSeconds }">
          <span>{{ Math.round(elapsedSeconds) }} Sekunden</span>
        </template>
      </CopilotChatReasoningMessage>
    `);

    expect(screen.getByText("0 Sekunden")).toBeDefined();
    vi.advanceTimersByTime(3000);
    await nextTick();
    expect(screen.getByText("3 Sekunden")).toBeDefined();
  });

  it("names the slash-command menu and its empty state", async () => {
    renderWithLabels(`<CopilotChatInput :tools-menu="toolsMenu" />`);

    await fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "/zzz" },
    });

    expect(
      await screen.findByRole("listbox", { name: "Befehle" }),
    ).toBeDefined();
    expect(screen.getByText("Keine Befehle gefunden")).toBeDefined();
  });

  it("names the attachment queue buttons and the preview close button", async () => {
    renderWithLabels(
      `<CopilotChatAttachmentQueue :attachments="attachments" />`,
    );

    expect(
      screen.getByRole("button", { name: "Anhang entfernen" }),
    ).toBeDefined();
    await fireEvent.click(
      screen.getByRole("button", { name: "Video abspielen" }),
    );
    expect(
      await screen.findByRole("button", { name: "Vorschau schließen" }),
    ).toBeDefined();
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
    renderWithLabels(`<CopilotModalHeader /><DrawerRegistrar />`);

    expect(
      await screen.findByRole("button", { name: "Unterhaltungen öffnen" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Schließen" })).toBeDefined();
  });

  it("names the sidebar", () => {
    renderWithLabels(`<CopilotSidebarView />`);

    // The sidebar starts closed, so it is aria-hidden until opened.
    expect(
      screen.getByRole("complementary", {
        name: "Chat-Seitenleiste",
        hidden: true,
      }),
    ).toBeDefined();
  });
});
