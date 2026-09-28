import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";

import { CopilotPopup } from "../copilot-popup";

@Component({ selector: "test-chat", template: "{{ label }}", standalone: true })
class TestChat {
  protected readonly label = "Chat";
}

@Component({ selector: "test-header", template: "Custom header" })
class TestHeader {}

describe("CopilotPopup", () => {
  afterEach(() => TestBed.resetTestingModule());

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

  it("opens by default with modal semantics and parity dimensions", async () => {
    const fixture = await render();
    const dialog = fixture.nativeElement.querySelector("[role=dialog]");

    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains("copilotKitPopup")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Focus starts on the close button.
    expect(document.activeElement).toBe(
      dialog.querySelector('[data-testid="copilot-close-button"]'),
    );
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

  it("keeps the earlier styling hooks", async () => {
    const fixture = await render();
    const element = fixture.nativeElement as HTMLElement;

    expect(
      element.querySelector("[data-copilot-popup-toggle]")?.classList,
    ).toContain("copilot-modal-toggle");
    expect(element.querySelector("[role=dialog]")?.classList).toContain(
      "copilot-popup-window",
    );
    expect(element.querySelector(".copilot-modal-header")).not.toBeNull();
    expect(element.querySelector(".copilot-modal-chat")).not.toBeNull();
  });

  it("gives a custom header the full row beside the close button", async () => {
    const fixture = await render({ headerComponent: TestHeader });
    const header: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="copilot-modal-header"]',
    );
    const custom = header.querySelector("test-header")!.parentElement!;

    expect(custom.classList).toContain("cpk:flex-1");
    expect(custom.classList).not.toContain("cpk:flex-[3]");
    expect(
      header.querySelector('[data-testid="copilot-header-title"]'),
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

    expect(title.textContent?.trim()).toBe("Copilot");
    expect(close.getAttribute("aria-label")).toBe("Close Copilot chat");

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
    expect(launcher.getAttribute("aria-label")).toBe("Open Copilot chat");
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
    expect(launcher.tabIndex).toBe(0);

    launcher.click();
    fixture.detectChanges();

    expect(launcher.getAttribute("data-state")).toBe("open");
    expect(launcher.getAttribute("aria-label")).toBe("Close Copilot chat");
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
    expect(launcher.tabIndex).toBe(-1);
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

    const dialog: HTMLElement =
      fixture.nativeElement.querySelector("[role=dialog]");
    expect(dialog.contains(document.activeElement)).toBe(true);
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("ignores Escape while focus is outside the popup", async () => {
    const fixture = await render();
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    try {
      outside.focus();
      outside.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector("[role=dialog]"),
      ).not.toBeNull();
    } finally {
      outside.remove();
    }
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
