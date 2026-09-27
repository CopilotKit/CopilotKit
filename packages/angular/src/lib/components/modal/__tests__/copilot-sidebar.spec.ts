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

  it("floats without a backdrop or body docking in overlay mode", async () => {
    const fixture = await render({ mode: "overlay", position: "right" });
    const sidebar = fixture.nativeElement.querySelector(
      "[data-copilot-sidebar]",
    );

    expect(sidebar.getAttribute("role")).toBe("complementary");
    expect(sidebar.hasAttribute("aria-modal")).toBe(false);
    expect(sidebar.contains(document.activeElement)).toBe(true);
    expect(document.body.style.marginInlineEnd).toBe("");
    expect(
      fixture.nativeElement.querySelector("[data-copilot-sidebar-backdrop]"),
    ).toBeNull();
  });

  it("closes an overlay on Escape and returns focus to the launcher", async () => {
    const fixture = await render({ mode: "overlay" });
    const launcher: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="copilot-chat-toggle"]',
    );

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      fixture.nativeElement.querySelector("[data-copilot-sidebar]"),
    ).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("closes on an outside pointerdown only with clickOutsideToClose", async () => {
    const fixture = await render({ mode: "overlay" });
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector("[data-copilot-sidebar]"),
    ).not.toBeNull();

    fixture.componentRef.setInput("clickOutsideToClose", true);
    fixture.detectChanges();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector("[data-copilot-sidebar]"),
    ).toBeNull();
  });

  it("puts the left-positioned launcher on the left", async () => {
    const fixture = await render({ position: "left", open: false });
    const launcher: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="copilot-chat-toggle"]',
    );

    expect(launcher.getAttribute("data-position")).toBe("left");
    expect(launcher.getAttribute("aria-label")).toBe("Open chat");
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
    expect(
      overlay.nativeElement.querySelector("[data-copilot-sidebar]"),
    ).not.toBeNull();
  });

  it("keeps overlay instances independently mounted", async () => {
    const first = await render({ mode: "overlay" });
    const second = TestBed.createComponent(CopilotSidebar);
    second.componentRef.setInput("chatComponent", TestChat);
    second.componentRef.setInput("mode", "overlay");
    second.detectChanges();
    await second.whenStable();

    const firstClose: HTMLButtonElement = first.nativeElement.querySelector(
      '[data-testid="copilot-close-button"]',
    );
    firstClose.click();
    first.detectChanges();

    expect(
      first.nativeElement.querySelector("[data-copilot-sidebar]"),
    ).toBeNull();
    expect(
      second.nativeElement.querySelector("[data-copilot-sidebar]"),
    ).not.toBeNull();
  });
});
