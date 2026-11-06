import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopilotSidebar } from "../copilot-sidebar";

@Component({ selector: "test-chat", template: "{{ label }}", standalone: true })
class TestChat {
  protected readonly label = "Chat";
}

@Component({ selector: "test-header", template: "Custom header" })
class TestHeader {}

describe("CopilotSidebar", () => {
  afterEach(() => {
    document.body.style.marginInlineStart = "";
    document.body.style.marginInlineEnd = "";
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  async function render(inputs: Record<string, unknown> = {}) {
    await TestBed.configureTestingModule({
      imports: [CopilotSidebar],
    }).compileComponents();
    const fixture = TestBed.createComponent(CopilotSidebar);
    fixture.componentRef.setInput("chatComponent", TestChat);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return fixture;
  }

  it("docks on either side with complementary landmark semantics", async () => {
    const fixture = await render({ position: "left", width: 360 });
    const sidebar = fixture.nativeElement.querySelector(
      "[data-copilot-sidebar]",
    );

    expect(sidebar.getAttribute("role")).toBe("complementary");
    expect(sidebar.classList.contains("copilotKitSidebar")).toBe(true);
    expect(sidebar.getAttribute("data-position")).toBe("left");
    expect(document.body.style.marginInlineStart).toBe("360px");

    fixture.destroy();
    expect(document.body.style.marginInlineStart).toBe("");
  });

  it("gives the page its own margins back when it closes", async () => {
    document.body.style.marginInlineEnd = "24px";
    const fixture = await render({ width: 400 });
    expect(document.body.style.marginInlineEnd).toBe("400px");

    fixture.destroy();

    expect(document.body.style.marginInlineEnd).toBe("24px");
  });

  it("becomes a modal below 768px, whatever the root font size", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(max-width: 767px)",
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList, // Only `matches` and the listeners are read.
    );
    const fixture = await render();

    const sidebar = fixture.nativeElement.querySelector(
      "[data-copilot-sidebar]",
    );
    expect(sidebar.getAttribute("role")).toBe("dialog");
    expect(document.body.style.marginInlineEnd).toBe("");
  });

  it("uses dialog semantics and no body docking in overlay mode", async () => {
    const fixture = await render({ mode: "overlay", position: "right" });
    const sidebar = fixture.nativeElement.querySelector(
      "[data-copilot-sidebar]",
    );

    expect(sidebar.getAttribute("role")).toBe("dialog");
    // No backdrop blocks the page, so the dialog does not claim to be modal.
    expect(sidebar.hasAttribute("aria-modal")).toBe(false);
    expect(sidebar.contains(document.activeElement)).toBe(true);
    expect(document.body.style.marginInlineEnd).toBe("");
  });

  it("closes the overlay on Escape and gives focus back to its toggle", async () => {
    const fixture = await render({ mode: "overlay" });
    const launcher: HTMLButtonElement = fixture.nativeElement.querySelector(
      "[data-copilot-sidebar-toggle]",
    );

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("animates the page margin after the first change, as in React and Vue", async () => {
    const fixture = await render({ width: 400 });
    expect(document.body.style.transition).toBe("");

    fixture.componentRef.setInput("width", 420);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.body.style.marginInlineEnd).toBe("420px");
    expect(document.body.style.transition).toContain("260ms");
    fixture.destroy();
    document.body.style.transition = "";
  });

  it("names a docked sidebar when a custom header replaces its heading", async () => {
    const fixture = await render({
      headerComponent: TestHeader,
      title: "Project copilot",
    });
    const sidebar: HTMLElement = fixture.nativeElement.querySelector(
      "[data-copilot-sidebar]",
    );

    expect(sidebar.getAttribute("aria-label")).toBe("Project copilot");
    expect(sidebar.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("rejects a second open docked sidebar without affecting overlays", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await render();
    const second = TestBed.createComponent(CopilotSidebar);
    second.componentRef.setInput("chatComponent", TestChat);
    second.detectChanges();
    await second.whenStable();

    expect(
      first.nativeElement.querySelector("[data-copilot-sidebar]"),
    ).not.toBeNull();
    expect(
      second.nativeElement.querySelector("[data-copilot-sidebar]"),
    ).toBeNull();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("one docked CopilotSidebar"),
    );

    const overlay = TestBed.createComponent(CopilotSidebar);
    overlay.componentRef.setInput("chatComponent", TestChat);
    overlay.componentRef.setInput("mode", "overlay");
    overlay.detectChanges();
    expect(overlay.nativeElement.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("keeps overlay instances independently mounted", async () => {
    const first = await render({ mode: "overlay" });
    const second = TestBed.createComponent(CopilotSidebar);
    second.componentRef.setInput("chatComponent", TestChat);
    second.componentRef.setInput("mode", "overlay");
    second.detectChanges();
    await second.whenStable();

    const firstClose: HTMLButtonElement = first.nativeElement.querySelector(
      ".cpk-modal-header-close-button",
    );
    firstClose.click();
    first.detectChanges();

    expect(first.nativeElement.querySelector("[role=dialog]")).toBeNull();
    expect(second.nativeElement.querySelector("[role=dialog]")).not.toBeNull();
  });
});
