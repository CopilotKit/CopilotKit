import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopilotSidebar } from "../copilot-sidebar";

@Component({ selector: "test-chat", template: "{{ label }}", standalone: true })
class TestChat {
  protected readonly label = "Chat";
}

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
    expect(sidebar.getAttribute("data-position")).toBe("left");
    expect(document.body.style.marginInlineStart).toBe("360px");

    fixture.destroy();
    expect(document.body.style.marginInlineStart).toBe("");
  });

  it("uses modal semantics and no body docking in overlay mode", async () => {
    const fixture = await render({ mode: "overlay", position: "right" });
    const sidebar = fixture.nativeElement.querySelector(
      "[data-copilot-sidebar]",
    );

    expect(sidebar.getAttribute("role")).toBe("dialog");
    expect(sidebar.getAttribute("aria-modal")).toBe("true");
    expect(sidebar.contains(document.activeElement)).toBe(true);
    expect(document.body.style.marginInlineEnd).toBe("");
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
      "[aria-label='Close Copilot sidebar']",
    );
    firstClose.click();
    first.detectChanges();

    expect(first.nativeElement.querySelector("[role=dialog]")).toBeNull();
    expect(second.nativeElement.querySelector("[role=dialog]")).not.toBeNull();
  });
});
