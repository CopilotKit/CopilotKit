import { ComponentFixture, TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopilotA2UIRecovery } from "../a2ui-recovery";

describe("CopilotA2UIRecovery", () => {
  let fixture: ComponentFixture<CopilotA2UIRecovery>;

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it("reveals a first retry only after the configured perceptibility delay", () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(CopilotA2UIRecovery);
    fixture.componentRef.setInput("content", {
      status: "retrying",
      attempt: 1,
      maxAttempts: 3,
    });
    fixture.componentRef.setInput("options", {
      showAfterMs: 2000,
      showAfterAttempts: 2,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Building interface");
    expect(fixture.nativeElement.textContent).not.toContain("Retrying");

    vi.advanceTimersByTime(2001);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Retrying generation");
    expect(fixture.nativeElement.textContent).toContain("1/3 attempts");
  });

  it("lets server diagnostic exposure override client configuration", () => {
    fixture = TestBed.createComponent(CopilotA2UIRecovery);
    fixture.componentRef.setInput("content", {
      status: "failed",
      error: "private diagnostic",
      debugExposure: "hidden",
    });
    fixture.componentRef.setInput("options", { debugExposure: "verbose" });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("details")).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      "private diagnostic",
    );

    fixture.componentRef.setInput("content", {
      status: "failed",
      error: "public diagnostic",
      debugExposure: "verbose",
    });
    fixture.componentRef.setInput("options", { debugExposure: "hidden" });
    fixture.detectChanges();
    const details = fixture.nativeElement.querySelector("details");
    expect(details.hasAttribute("open")).toBe(true);
    expect(details.textContent).toContain("public diagnostic");
  });

  it("keeps the retry timer running while streamed snapshots arrive", () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(CopilotA2UIRecovery);
    fixture.componentRef.setInput("options", { showAfterMs: 2000 });
    fixture.componentRef.setInput("content", {
      status: "retrying",
      attempt: 1,
      progressTokens: 10,
    });
    fixture.detectChanges();

    vi.advanceTimersByTime(1500);
    fixture.componentRef.setInput("content", {
      status: "retrying",
      attempt: 1,
      progressTokens: 40,
    });
    fixture.detectChanges();
    vi.advanceTimersByTime(500);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("Retrying generation");
  });

  it("labels failure details the same way React and Vue do", () => {
    fixture = TestBed.createComponent(CopilotA2UIRecovery);
    fixture.componentRef.setInput("content", { status: "failed", error: "x" });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("summary").textContent).toBe(
      "developer details",
    );
  });
});
