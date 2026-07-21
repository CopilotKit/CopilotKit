import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import type { AngularToolCall } from "../../../tools";
import {
  CopilotDefaultToolRenderer,
  safeToolValue,
} from "../default-tool-renderer";

describe("CopilotDefaultToolRenderer", () => {
  it("serializes cycles, bigint, and undefined without throwing", () => {
    const value: Record<string, unknown> = { count: 12n, missing: undefined };
    value["self"] = value;

    expect(safeToolValue(value)).toContain('"count": "12n"');
    expect(safeToolValue(value)).toContain('"self": "[Circular]"');
  });

  it("exposes keyboard-operable expansion and unknown statuses", async () => {
    await TestBed.configureTestingModule({
      imports: [CopilotDefaultToolRenderer],
    }).compileComponents();
    const fixture = TestBed.createComponent(CopilotDefaultToolRenderer);
    fixture.componentRef.setInput("toolCall", {
      name: "future_tool",
      args: { city: "Paris" },
      status: "future-status",
      result: undefined,
    } as unknown as AngularToolCall);
    fixture.detectChanges();

    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      "button[aria-expanded]",
    );
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="copilot-tool-render"]',
      ),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="copilot-tool-render-status"]',
      ),
    ).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.nativeElement.textContent).toContain("Unknown status");

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(fixture.nativeElement.textContent).toContain('"city": "Paris"');
  });
});
