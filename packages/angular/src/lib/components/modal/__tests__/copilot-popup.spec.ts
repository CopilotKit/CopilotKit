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

  it("opens by default with modal semantics and parity dimensions", async () => {
    const fixture = await render();
    const dialog = fixture.nativeElement.querySelector("[role=dialog]");

    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains("copilotKitPopup")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.style.getPropertyValue("--copilot-popup-width")).toBe(
      "420px",
    );
    expect(dialog.style.getPropertyValue("--copilot-popup-height")).toBe(
      "560px",
    );
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
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("honors opt-in outside-click closing", async () => {
    const fixture = await render({ clickOutsideToClose: true });
    const backdrop: HTMLElement = fixture.nativeElement.querySelector(
      "[data-copilot-popup-backdrop]",
    );

    backdrop.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).toBeNull();
  });

  it("keeps the popup open on backdrop clicks by default", async () => {
    const fixture = await render();
    const backdrop: HTMLElement = fixture.nativeElement.querySelector(
      "[data-copilot-popup-backdrop]",
    );

    backdrop.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).not.toBeNull();
  });
});
