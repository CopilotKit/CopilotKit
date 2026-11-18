import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@ag-ui/core";

import { CopilotInspector } from "../../../inspector";
import { provideCopilotChatConfiguration } from "../../../chat-configuration";
import { CopilotChatAssistantMessage } from "../copilot-chat-assistant-message";
import {
  CopilotChatInspectorButton,
  inspectorShortcutsHidden,
  ɵresetInspectorShortcuts,
} from "../copilot-chat-inspector-button";

const message: AssistantMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "Hello",
};

function setup(isInspectorEnabled = true) {
  const openInspector = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CopilotInspector,
        useValue: { isInspectorEnabled, openInspector },
      },
      provideCopilotChatConfiguration({ threadId: "thread-1" }),
    ],
  });
  const fixture = TestBed.createComponent(CopilotChatAssistantMessage);
  fixture.componentRef.setInput("message", message);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const trigger = () =>
    root.querySelector<HTMLButtonElement>(
      '[data-testid="copilot-inspector-button"]',
    );
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
  const pointer = (el: Element, type: string, pointerType = "mouse") => {
    const event = new Event(type);
    Object.assign(event, { pointerType });
    el.dispatchEvent(event);
    fixture.detectChanges();
  };
  const key = (el: Element, keyName: string) => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: keyName, bubbles: true }),
    );
    fixture.detectChanges();
  };
  return { fixture, root, trigger, menu, pointer, key, openInspector };
}

const expectedRequest = {
  messageId: "assistant-1",
  threadId: "thread-1",
  agentId: "default",
};

describe("CopilotChatInspectorButton", () => {
  afterEach(() => {
    ɵresetInspectorShortcuts();
    TestBed.resetTestingModule();
    document.querySelector(".cdk-overlay-container")?.remove();
  });

  it("is not in the toolbar while the Inspector is disabled", () => {
    const { trigger } = setup(false);
    expect(trigger()).toBeNull();
  });

  it("renders React's icon button in the toolbar", () => {
    const { trigger, root } = setup();
    const button = trigger()!;
    expect(button.getAttribute("aria-label")).toBe(
      "CopilotKit Inspector (local only)",
    );
    expect(button.classList).toContain("cpk-inspector-button");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent?.trim()).toBe("");
    expect(
      root.querySelector('[data-testid="copilot-inspector-icon"] svg'),
    ).not.toBeNull();
  });

  it("opens a menu on hover whose item opens the message", () => {
    const { trigger, menu, pointer, openInspector, fixture } = setup();
    pointer(trigger()!, "pointerenter");

    expect(menu()).not.toBeNull();
    expect(trigger()!.getAttribute("aria-expanded")).toBe("true");
    const items = Array.from(menu()!.querySelectorAll('[role="menuitem"]'));
    const text = (item: Element, part: string) =>
      item.querySelector(`.cpk-inspector-button-menu-item-${part}`)
        ?.textContent;
    expect(
      items.map((item) => [text(item, "label"), text(item, "description")]),
    ).toEqual([
      ["View in Inspector", "Open this message in the Inspector"],
      ["Hide this icon", "Until you reload this page"],
    ]);

    (items[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(openInspector).toHaveBeenCalledExactlyOnceWith(expectedRequest);
    expect(menu()).toBeNull();
  });

  it.each(["click", "Enter", " "])(
    "opens the Inspector directly on %s",
    (interaction) => {
      const { trigger, menu, key, openInspector, fixture } = setup();
      if (interaction === "click") {
        trigger()!.click();
        fixture.detectChanges();
      } else {
        key(trigger()!, interaction);
      }
      expect(openInspector).toHaveBeenCalledExactlyOnceWith(expectedRequest);
      expect(menu()).toBeNull();
    },
  );

  it("keeps focus on hover and moves it into the menu on ArrowDown", () => {
    const { trigger, menu, pointer, key } = setup();
    const outside = document.createElement("textarea");
    document.body.appendChild(outside);
    outside.focus();

    pointer(trigger()!, "pointerenter");
    expect(document.activeElement).toBe(outside);
    pointer(trigger()!, "pointerleave");
    outside.remove();

    trigger()!.focus();
    key(trigger()!, "ArrowDown");
    expect(menu()!.contains(document.activeElement)).toBe(true);

    key(document.activeElement!, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes the hover menu once the pointer leaves it", async () => {
    const { trigger, menu, pointer } = setup();
    pointer(trigger()!, "pointerenter");
    pointer(trigger()!, "pointerleave");
    pointer(menu()!, "pointerenter");
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(menu()).not.toBeNull();

    pointer(menu()!, "pointerleave");
    await vi.waitFor(() => expect(menu()).toBeNull());
  });

  it("hides every shortcut until the page reloads", () => {
    const { trigger, menu, pointer, fixture } = setup();
    pointer(trigger()!, "pointerenter");
    (
      menu()!.querySelector(".cpk-inspector-button-hide-item") as HTMLElement
    ).click();
    fixture.detectChanges();

    expect(inspectorShortcutsHidden()).toBe(true);
    expect(trigger()).toBeNull();
  });

  it("can be used on its own", () => {
    const openInspector = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CopilotInspector,
          useValue: { isInspectorEnabled: true, openInspector },
        },
      ],
    });
    const fixture = TestBed.createComponent(CopilotChatInspectorButton);
    fixture.componentRef.setInput("messageId", "m-9");
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector("button")!.click();
    expect(openInspector).toHaveBeenCalledWith({
      messageId: "m-9",
      threadId: undefined,
      agentId: undefined,
    });
  });
});
