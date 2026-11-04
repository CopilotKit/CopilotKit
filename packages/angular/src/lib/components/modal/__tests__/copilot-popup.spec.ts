import { Component, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { CopilotPopup } from "../copilot-popup";
import { COPILOT_CHAT_WELCOME_LAYOUT } from "../../chat/copilot-chat-welcome-layout";

@Component({ selector: "test-chat", template: "{{ label }}", standalone: true })
class TestChat {
  protected readonly label = "Chat";
}

@Component({
  selector: "test-layout-chat",
  template: "{{ layout }}",
  standalone: true,
})
class LayoutReportingChat {
  protected readonly layout = inject(COPILOT_CHAT_WELCOME_LAYOUT, {
    optional: true,
  });
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

  /** A pointer down on the page, outside the popup. */
  function pointerDownOutside() {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    outside.remove();
  }

  it("honors opt-in outside-click closing", async () => {
    const fixture = await render({ clickOutsideToClose: true });

    pointerDownOutside();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).toBeNull();
  });

  it("keeps the popup open on outside clicks by default", async () => {
    const fixture = await render();

    pointerDownOutside();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("does not treat a press on its own toggle as an outside click", async () => {
    const fixture = await render({ clickOutsideToClose: true });
    const launcher: HTMLButtonElement = fixture.nativeElement.querySelector(
      "[data-copilot-popup-toggle]",
    );

    launcher.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("closes on Escape while focus is outside the popup, as in React", async () => {
    const fixture = await render();

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).toBeNull();
  });

  it("keeps Tab inside the popup", async () => {
    const fixture = await render();
    const dialog: HTMLElement =
      fixture.nativeElement.querySelector("[role=dialog]");
    const close: HTMLButtonElement = dialog.querySelector(
      ".cpk-modal-header-close-button",
    )!;
    expect(document.activeElement).toBe(close);

    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    close.dispatchEvent(tab);

    // The close button is the only focusable element, so Tab wraps to it.
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it("gives its chat React's popup welcome layout", async () => {
    const fixture = await render({ chatComponent: LayoutReportingChat });
    const dialog: HTMLElement =
      fixture.nativeElement.querySelector("[role=dialog]");

    expect(dialog.textContent?.trim()).toContain("popup");
  });
});
