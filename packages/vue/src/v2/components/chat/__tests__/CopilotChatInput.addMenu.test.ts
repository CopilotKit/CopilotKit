import { defineComponent, h, nextTick } from "vue";
import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatInput from "../CopilotChatInput.vue";
import type { ToolsMenuItem } from "../types";

const getAddButton = () =>
  screen.getByTestId("copilot-chat-input-add") as HTMLButtonElement;

const pointer = (type: string, init: Record<string, unknown> = {}) =>
  Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    pointerType: "mouse",
    button: 0,
    ctrlKey: false,
    ...init,
  });

function renderInput(
  props: Record<string, unknown> = {},
  labels?: Record<string, string>,
) {
  return render(
    defineComponent({
      setup() {
        return () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "test-thread", labels },
            {
              default: () =>
                h(CopilotChatInput, {
                  autoFocus: false,
                  onSubmitMessage: () => {},
                  ...props,
                }),
            },
          );
      },
    }),
  );
}

const toolsMenu = (
  spies: Record<string, () => void>,
): (ToolsMenuItem | "-")[] => [
  { label: "Insert date", action: spies.date! },
  "-",
  {
    label: "Templates",
    items: [
      { label: "Bug report", action: spies.bug! },
      { label: "Feature request", action: spies.feature! },
    ],
  },
  { label: "Clear", action: spies.clear! },
];

function spies() {
  return {
    date: vi.fn(),
    bug: vi.fn(),
    feature: vi.fn(),
    clear: vi.fn(),
  };
}

describe("CopilotChatInput add menu", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("marks the trigger as a menu button and points it at the open menu", async () => {
    renderInput({ toolsMenu: toolsMenu(spies()) });
    const button = getAddButton();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("data-state")).toBe("closed");

    await fireEvent.click(button);
    const content = screen.getByRole("menu");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("data-state")).toBe("open");
    expect(button.getAttribute("aria-controls")).toBe(content.id);
    expect(content.getAttribute("aria-labelledby")).toBe(button.id);
    expect(content.classList.contains("cpk-dropdown-menu-content")).toBe(true);
    expect(content.getAttribute("data-slot")).toBe("dropdown-menu-content");
    expect(content.hasAttribute("data-copilotkit")).toBe(true);
    // Teleported out of the input, as Radix portals it.
    expect(
      screen.getByTestId("copilot-chat-input-container").contains(content),
    ).toBe(false);
  });

  it("renders a submenu trigger instead of a flattened labelled group", async () => {
    renderInput({ toolsMenu: toolsMenu(spies()) });
    await fireEvent.click(getAddButton());

    const subTrigger = screen.getByRole("menuitem", { name: "Templates" });
    expect(subTrigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(subTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(subTrigger.classList.contains("cpk-dropdown-menu-sub-trigger")).toBe(
      true,
    );
    expect(
      subTrigger.querySelector(".cpk-dropdown-menu-sub-trigger-icon"),
    ).not.toBeNull();
    // The submenu's items are not in the menu until it opens.
    expect(screen.queryByRole("menuitem", { name: "Bug report" })).toBeNull();
    expect(document.querySelector(".cpk-dropdown-menu-label")).toBeNull();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("opens from the keyboard on its first item, and ArrowUp opens on the last", async () => {
    renderInput({ toolsMenu: toolsMenu(spies()) });
    const button = getAddButton();

    await fireEvent.keyDown(button, { key: "ArrowDown" });
    await waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe("Insert date"),
    );

    await fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await fireEvent.keyDown(button, { key: "ArrowUp" });
    await waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe("Clear"),
    );
  });

  it("moves focus with the arrow keys, Home, End, and type-ahead", async () => {
    renderInput({ toolsMenu: toolsMenu(spies()) });
    await fireEvent.keyDown(getAddButton(), { key: "Enter" });
    await waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe("Insert date"),
    );
    const focused = () => document.activeElement?.textContent?.trim();

    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focused()).toBe("Templates");
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focused()).toBe("Clear");
    // Radix menus do not wrap by default.
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focused()).toBe("Clear");
    await fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(focused()).toBe("Insert date");
    await fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(focused()).toBe("Clear");
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(focused()).toBe("Templates");
    await fireEvent.keyDown(document.activeElement!, { key: "i" });
    expect(focused()).toBe("Insert date");
  });

  it("runs an item on Enter, closes, and returns focus to the trigger", async () => {
    const actions = spies();
    renderInput({ toolsMenu: toolsMenu(actions) });
    const button = getAddButton();
    await fireEvent.keyDown(button, { key: "Enter" });
    await waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe("Insert date"),
    );

    await fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(actions.date).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("opens a submenu with ArrowRight on its first item, and ArrowLeft closes it", async () => {
    const actions = spies();
    renderInput({ toolsMenu: toolsMenu(actions) });
    await fireEvent.keyDown(getAddButton(), { key: "Enter" });
    await waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe("Insert date"),
    );
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    const subTrigger = screen.getByRole("menuitem", { name: "Templates" });
    expect(document.activeElement).toBe(subTrigger);

    await fireEvent.keyDown(subTrigger, { key: "ArrowRight" });
    const bug = await screen.findByRole("menuitem", { name: "Bug report" });
    await waitFor(() => expect(document.activeElement).toBe(bug));
    expect(subTrigger.getAttribute("aria-expanded")).toBe("true");
    const subContent = bug.closest('[role="menu"]') as HTMLElement;
    expect(subContent.classList.contains("cpk-dropdown-menu-sub-content")).toBe(
      true,
    );
    expect(subTrigger.getAttribute("aria-controls")).toBe(subContent.id);

    await fireEvent.keyDown(bug, { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement).toBe(subTrigger));
    expect(subTrigger.getAttribute("aria-expanded")).toBe("false");

    // Enter on the submenu trigger opens it too; Enter on an item runs it.
    await fireEvent.keyDown(subTrigger, { key: "Enter" });
    const feature = await screen.findByRole("menuitem", {
      name: "Feature request",
    });
    await waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe("Bug report"),
    );
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(feature);
    await fireEvent.keyDown(feature, { key: "Enter" });
    expect(actions.feature).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryAllByRole("menu")).toHaveLength(0));
    expect(document.activeElement).toBe(getAddButton());
  });

  it("closes the whole menu on Escape in a submenu without reaching outer Escape listeners", async () => {
    renderInput({ toolsMenu: toolsMenu(spies()) });
    const windowEscape = vi.fn();
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") windowEscape();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    try {
      await fireEvent.keyDown(getAddButton(), { key: "ArrowDown" });
      await waitFor(() =>
        expect(document.activeElement?.textContent?.trim()).toBe("Insert date"),
      );
      await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      await fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
      const bug = await screen.findByRole("menuitem", { name: "Bug report" });
      await waitFor(() => expect(document.activeElement).toBe(bug));

      await fireEvent.keyDown(bug, { key: "Escape" });
      await waitFor(() =>
        expect(getAddButton().getAttribute("aria-expanded")).toBe("false"),
      );
      expect(document.activeElement).toBe(getAddButton());
      expect(windowEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKeyDown);
    }
  });

  it("closes on Tab and returns focus to the trigger", async () => {
    renderInput({ toolsMenu: toolsMenu(spies()) });
    await fireEvent.keyDown(getAddButton(), { key: "ArrowDown" });
    await waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe("Insert date"),
    );
    await fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(getAddButton().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(getAddButton());
  });

  it("opens on pointer down, and a pointer down outside closes it", async () => {
    renderInput({ toolsMenu: toolsMenu(spies()) });
    const button = getAddButton();
    button.dispatchEvent(pointer("pointerdown"));
    // The click that follows the pointer down does not toggle it again.
    await fireEvent.click(button, { detail: 1 });
    await nextTick();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const content = screen.getByRole("menu");
    await waitFor(() => expect(document.activeElement).toBe(content));

    document.body.dispatchEvent(pointer("pointerdown"));
    await nextTick();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a submenu on hover and focuses the hovered item", async () => {
    vi.useFakeTimers();
    const actions = spies();
    renderInput({ toolsMenu: toolsMenu(actions) });
    await fireEvent.click(getAddButton(), { detail: 1 });
    await nextTick();
    const subTrigger = screen.getByRole("menuitem", { name: "Templates" });

    subTrigger.dispatchEvent(pointer("pointermove"));
    expect(document.activeElement).toBe(subTrigger);
    expect(screen.queryByRole("menuitem", { name: "Bug report" })).toBeNull();
    await vi.advanceTimersByTimeAsync(150);
    const bug = screen.getByRole("menuitem", { name: "Bug report" });
    // Opening on hover leaves focus on the trigger.
    expect(document.activeElement).toBe(subTrigger);

    await fireEvent.click(bug);
    expect(actions.bug).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.queryAllByRole("menu")).toHaveLength(0);
  });

  it("shows the add button label and the / shortcut in its tooltip", async () => {
    renderInput(
      { onAddFile: vi.fn() },
      { chatInputToolbarAddButtonLabel: "Upload attachment" },
    );
    const button = getAddButton();
    await fireEvent.focus(button);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Upload attachment");
    expect(tooltip.querySelector("code")?.textContent?.trim()).toBe("/");
    expect(
      tooltip.querySelector(".cpk-chat-input-add-menu-tooltip"),
    ).not.toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("hides the add button tooltip while the menu is open", async () => {
    renderInput({ onAddFile: vi.fn() });
    const button = getAddButton();
    await fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    await fireEvent.keyDown(button, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("gives the transcribe buttons a tooltip with their label instead of a title", async () => {
    renderInput({ onStartTranscribe: vi.fn() });
    const start = screen.getByTestId("copilot-chat-input-start-transcribe");
    expect(start.hasAttribute("title")).toBe(false);
    await fireEvent.focus(start);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent?.trim()).toBe("Transcribe");
    expect(tooltip.getAttribute("data-side")).toBe("bottom");
    expect(start.getAttribute("aria-describedby")).toBe(tooltip.id);
  });
});
