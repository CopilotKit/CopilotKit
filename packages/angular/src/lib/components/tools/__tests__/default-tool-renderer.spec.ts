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
    const container: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="copilot-tool-render"]',
    );
    expect(container).not.toBeNull();
    expect(container.getAttribute("data-tool-name")).toBe("future_tool");
    expect(container.getAttribute("data-status")).toBe("unknown");
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

  it("labels active calls Running with a shimmer and completed calls Done", async () => {
    await TestBed.configureTestingModule({
      imports: [CopilotDefaultToolRenderer],
    }).compileComponents();
    const fixture = TestBed.createComponent(CopilotDefaultToolRenderer);
    const name = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="copilot-tool-render-name"]',
      ) as HTMLElement;
    const status = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="copilot-tool-render-status"]',
      ) as HTMLElement;

    fixture.componentRef.setInput("toolCall", {
      name: "search",
      args: { query: "signals" },
      status: "executing",
      result: undefined,
    } as AngularToolCall);
    fixture.detectChanges();
    expect(status().textContent?.trim()).toBe("Running");
    expect(name().classList).toContain("cpk-shimmer");
    expect(status().classList).toContain("cpk-shimmer");

    fixture.componentRef.setInput("toolCall", {
      name: "search",
      args: { query: "signals" },
      status: "complete",
      result: "3 results",
    } as AngularToolCall);
    fixture.detectChanges();
    expect(status().textContent?.trim()).toBe("Done");
    expect(name().classList).not.toContain("cpk-shimmer");
    expect(status().classList).not.toContain("cpk-shimmer");
  });
});
