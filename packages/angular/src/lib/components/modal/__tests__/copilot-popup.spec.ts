import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { CopilotPopup } from "../copilot-popup";

@Component({ selector: "test-chat", template: "{{ label }}", standalone: true })
class TestChat {
  protected readonly label = "Chat";
}

describe("CopilotPopup", () => {
  async function render(inputs: Record<string, unknown> = {}) {
    await TestBed.configureTestingModule({
      imports: [CopilotPopup],
    }).compileComponents();
    const fixture = TestBed.createComponent(CopilotPopup);
    fixture.componentRef.setInput("chatComponent", TestChat);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return fixture;
  }

  it("opens by default as a non-modal dialog with parity dimensions", async () => {
    const fixture = await render();
    const dialog = fixture.nativeElement.querySelector("[role=dialog]");

    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains("copilotKitPopup")).toBe(true);
    expect(dialog.hasAttribute("aria-modal")).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.style.getPropertyValue("--copilot-popup-width")).toBe(
      "420px",
    );
    expect(dialog.style.getPropertyValue("--copilot-popup-height")).toBe(
      "560px",
    );
    // No backdrop: nothing but the launcher and the window.
    expect(
      fixture.nativeElement.querySelector("[data-copilot-popup-backdrop]"),
    ).toBeNull();
  });

  it("renders React's header: centered default title and a close button", async () => {
    const fixture = await render();
    const title: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="copilot-header-title"]',
    );
    const close: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="copilot-close-button"]',
    );

    expect(title.textContent?.trim()).toBe("CopilotKit Chat");
    expect(close.getAttribute("aria-label")).toBe("Close");

    close.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("[role=dialog]")).toBeNull();
  });

  it("swaps the launcher icon and label with the open state", async () => {
    const fixture = await render({ open: false });
    const launcher: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="copilot-chat-toggle"]',
    );

    expect(launcher.getAttribute("data-state")).toBe("closed");
    expect(launcher.getAttribute("aria-label")).toBe("Open chat");
    expect(launcher.getAttribute("aria-expanded")).toBe("false");

    launcher.click();
    fixture.detectChanges();

    expect(launcher.getAttribute("data-state")).toBe("open");
    expect(launcher.getAttribute("aria-label")).toBe("Close chat");
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
    expect(launcher.tabIndex).toBe(0);
  });

  it("closes on Escape and restores focus to its launcher", async () => {
    const fixture = await render({ open: false });
    const launcher: HTMLButtonElement = fixture.nativeElement.querySelector(
      "[data-copilot-popup-toggle]",
    );
    launcher.focus();
    launcher.click();
    fixture.detectChanges();
    await fixture.whenStable();

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("closes on an outside pointerdown only with clickOutsideToClose", async () => {
    const fixture = await render({ clickOutsideToClose: true });
    const dialog: HTMLElement =
      fixture.nativeElement.querySelector("[role=dialog]");

    dialog.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("[role=dialog]")).not.toBeNull();

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("[role=dialog]")).toBeNull();
  });

  it("stays open on outside pointerdown by default", async () => {
    const fixture = await render();

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).not.toBeNull();
  });
});
