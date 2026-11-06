import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, nextTick, provide } from "vue";
import type { Component } from "vue";
import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import type { AssistantMessage } from "@ag-ui/core";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { InspectorKey } from "../../../providers/keys";
import { ɵresetInspectorShortcuts } from "../inspector-shortcuts";

const THREAD_ID = "thread-inspector";
const message: AssistantMessage = {
  id: "message-1",
  role: "assistant",
  content: "Inspect me",
};

function renderMessage({
  enabled = true,
  openInspector = vi.fn(),
  slots = {},
  before,
}: {
  enabled?: boolean;
  openInspector?: ReturnType<typeof vi.fn>;
  slots?: Record<string, unknown>;
  before?: () => unknown;
} = {}) {
  const InspectorContext = defineComponent({
    setup(_, { slots: children }) {
      provide(InspectorKey, {
        isInspectorEnabled: computed(() => enabled),
        openInspector,
      });
      return () => children.default?.();
    },
  });
  const Harness = defineComponent({
    setup() {
      return () =>
        h(CopilotKitProvider, null, {
          default: () =>
            h(InspectorContext, null, {
              default: () =>
                h(
                  CopilotChatConfigurationProvider,
                  { threadId: THREAD_ID },
                  {
                    default: () => [
                      before?.(),
                      h(
                        CopilotChatAssistantMessage as Component,
                        { message },
                        slots,
                      ),
                    ],
                  },
                ),
            }),
        });
    },
  });
  render(Harness);
  return { openInspector };
}

const expectedRequest = {
  messageId: message.id,
  threadId: THREAD_ID,
  agentId: "default",
};

describe("CopilotChatAssistantMessage Inspector button", () => {
  afterEach(() => {
    ɵresetInspectorShortcuts();
    document.body.innerHTML = "";
  });

  it("renders no Inspector button while the Inspector is off", () => {
    renderMessage({ enabled: false });

    expect(
      screen.queryByRole("button", { name: /copilotkit inspector/i }),
    ).toBeNull();
  });

  it("renders the local Inspector button and opens it from the toolbar", async () => {
    const { openInspector } = renderMessage();

    const inspectorButton = screen.getByRole("button", {
      name: "CopilotKit Inspector (local only)",
    });
    const inspectorIcon = screen.getByTestId("copilot-inspector-icon");
    expect(inspectorIcon.classList.contains("lucide-wrench")).toBe(true);
    expect(inspectorButton.textContent).toBe("");
    expect(inspectorButton.getAttribute("aria-haspopup")).toBe("menu");
    expect(inspectorButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    await fireEvent.pointerEnter(inspectorButton, { pointerType: "mouse" });
    const item = await screen.findByRole("menuitem", {
      name: "View in Inspector Open this message in the Inspector",
    });
    expect(inspectorButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu").classList).toContain(
      "cpk-inspector-button-menu",
    );

    await fireEvent.click(item);

    expect(openInspector).toHaveBeenCalledWith(expectedRequest);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it.each(["click", "hover then click", "Enter", " "])(
    "opens Inspector directly on %s",
    async (interaction) => {
      const { openInspector } = renderMessage();
      const trigger = screen.getByTestId("copilot-inspector-button");
      if (interaction === "hover then click") {
        await fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
        expect(screen.getByRole("menu")).toBeDefined();
      }
      if (interaction.includes("click")) {
        await fireEvent.pointerDown(trigger, { button: 0 });
        if (interaction === "click") {
          expect(screen.queryByRole("menu")).toBeNull();
        }
        await fireEvent.click(trigger);
      } else {
        await fireEvent.keyDown(trigger, { key: interaction });
      }
      expect(openInspector).toHaveBeenCalledExactlyOnceWith(expectedRequest);
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    },
  );

  it.each(["hover", "keyboard"])(
    "preserves the appropriate focus when opening by %s",
    async (interaction) => {
      renderMessage({
        before: () => h("textarea", { "aria-label": "Chat input" }),
      });
      const input = screen.getByRole("textbox", { name: "Chat input" });
      input.focus();
      const trigger = screen.getByTestId("copilot-inspector-button");
      if (interaction === "hover") {
        await fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
      } else {
        trigger.focus();
        await fireEvent.keyDown(trigger, { key: "ArrowDown" });
      }
      const menu = await screen.findByRole("menu");
      if (interaction === "hover") {
        expect(document.activeElement).toBe(input);
      } else {
        await waitFor(() =>
          expect(menu.contains(document.activeElement)).toBe(true),
        );
      }
    },
  );

  it("Escape closes a keyboard-opened menu and returns focus to the button", async () => {
    renderMessage();
    const trigger = screen.getByTestId("copilot-inspector-button");
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    await waitFor(() =>
      expect(menu.contains(document.activeElement)).toBe(true),
    );

    await fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses the hover menu when the pointer leaves", async () => {
    renderMessage();
    const trigger = screen.getByTestId("copilot-inspector-button");
    await fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    const menu = await screen.findByRole("menu");
    await fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
    await fireEvent.pointerEnter(menu, { pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(screen.getByRole("menu")).toBeDefined();
    await fireEvent.pointerLeave(menu, { pointerType: "mouse" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("hides the shortcut until the page reloads", async () => {
    renderMessage();
    await fireEvent.pointerEnter(
      screen.getByTestId("copilot-inspector-button"),
      { pointerType: "mouse" },
    );

    await fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "Hide this icon Until you reload this page",
      }),
    );
    await nextTick();

    expect(screen.queryByTestId("copilot-inspector-button")).toBeNull();
  });

  it("replaces the default Inspector button with the inspector-button slot", async () => {
    const { openInspector } = renderMessage({
      slots: {
        "inspector-button": ({ onInspect }: { onInspect: () => void }) =>
          h("button", { type: "button", onClick: onInspect }, "Custom inspect"),
      },
    });

    expect(screen.queryByTestId("copilot-inspector-button")).toBeNull();
    await fireEvent.click(
      screen.getByRole("button", { name: "Custom inspect" }),
    );
    expect(openInspector).toHaveBeenCalledExactlyOnceWith(expectedRequest);
  });

  it("does not render the inspector-button slot while the Inspector is off", () => {
    renderMessage({
      enabled: false,
      slots: {
        "inspector-button": () => h("button", "Custom inspect"),
      },
    });

    expect(screen.queryByRole("button", { name: "Custom inspect" })).toBeNull();
  });
});

describe("CopilotChatAssistantMessage toolbar tooltips", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows each toolbar label as a tooltip instead of a title", async () => {
    render(
      defineComponent({
        setup: () => () =>
          h(CopilotKitProvider, null, {
            default: () =>
              h(CopilotChatAssistantMessage as Component, {
                message,
                onRegenerate: () => {},
              }),
          }),
      }),
    );
    const copy = screen.getByTestId("copilot-copy-button");
    expect(copy.hasAttribute("title")).toBe(false);

    await fireEvent.focus(copy);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("Copy");
    expect(tooltip.getAttribute("data-side")).toBe("bottom");
    expect(copy.getAttribute("aria-describedby")).toBe(tooltip.id);
    await fireEvent.blur(copy);

    await fireEvent.focus(screen.getByRole("button", { name: "Regenerate" }));
    expect(screen.getByRole("tooltip").textContent).toBe("Regenerate");
  });
});
