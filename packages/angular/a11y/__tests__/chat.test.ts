import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { CopilotPopup } from "../../src/lib/components/modal/copilot-popup";
import { CopilotSidebar } from "../../src/lib/components/modal/copilot-sidebar";
import { observeClicks } from "../../../a11y-test-kit/src/index";
import { audit } from "../../../a11y-test-kit/src/report";

@Component({ selector: "test-chat", template: "{{ text }}", standalone: true })
class TestChat {
  readonly text = "Chat";
}
afterEach(() => TestBed.resetTestingModule());
describe("chat accessibility baseline", () => {
  it.each([
    ["chat-popup", CopilotPopup],
    ["chat-sidebar", CopilotSidebar],
  ] as const)("%s", async (name, View) => {
    const stop = observeClicks();
    let clicks: ReadonlySet<Element>;
    let host: Element;
    try {
      await TestBed.configureTestingModule({
        imports: [View],
      }).compileComponents();
      const fixture = TestBed.createComponent<CopilotPopup | CopilotSidebar>(
        View,
      );
      fixture.componentRef.setInput("chatComponent", TestChat);
      if (name === "chat-sidebar")
        fixture.componentRef.setInput("mode", "overlay");
      fixture.detectChanges();
      await fixture.whenStable();
      host = fixture.nativeElement;
    } finally {
      clicks = stop();
    }
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await audit("angular", name, clicks!, host!, "dialog");
  });
});
