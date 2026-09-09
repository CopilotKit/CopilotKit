import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";

import { CopilotPopup } from "../copilot-popup";
import { CopilotSidebar } from "../copilot-sidebar";

@Component({
  selector: "test-chat",
  template: "{{ label }}",
  standalone: true,
})
class TestChat {
  protected readonly label = "Chat";
}

describe("modal chat accessibility", () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(
    component: typeof CopilotPopup | typeof CopilotSidebar,
  ) {
    await TestBed.configureTestingModule({
      imports: [component],
    }).compileComponents();
    const fixture = TestBed.createComponent(component);
    fixture.componentRef.setInput("chatComponent", TestChat);
    if (component === CopilotSidebar) {
      fixture.componentRef.setInput("mode", "overlay");
    }
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it.each([
    ["popup", CopilotPopup],
    ["overlay sidebar", CopilotSidebar],
  ])(
    "has no automated accessibility violations in the %s",
    async (_, component) => {
      const element = await render(component);
      const result = await axe.run(element);

      expect(result.violations).toEqual([]);
    },
  );
});
