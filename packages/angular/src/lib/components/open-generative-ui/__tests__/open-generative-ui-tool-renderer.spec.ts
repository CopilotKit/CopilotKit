import { ComponentFixture, TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotOpenGenerativeUIToolRenderer } from "../open-generative-ui-tool-renderer";

describe("CopilotOpenGenerativeUIToolRenderer", () => {
  let fixture: ComponentFixture<CopilotOpenGenerativeUIToolRenderer>;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CopilotOpenGenerativeUIToolRenderer],
    });
    fixture = TestBed.createComponent(CopilotOpenGenerativeUIToolRenderer);
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
  });

  it("shows streamed placeholder messages while the sandbox tool is in progress", () => {
    fixture.componentRef.setInput("toolCall", {
      status: "in-progress",
      args: {
        placeholderMessages: ["Planning dashboard", "Choosing chart library"],
      },
      result: undefined,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      "Choosing chart library",
    );

    vi.advanceTimersByTime(5000);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("Planning dashboard");
  });

  it("hides once the tool call is complete", () => {
    fixture.componentRef.setInput("toolCall", {
      status: "complete",
      args: {
        initialHeight: 300,
        placeholderMessages: ["Generating UI"],
      },
      result: "UI generated",
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe("");
  });
});
