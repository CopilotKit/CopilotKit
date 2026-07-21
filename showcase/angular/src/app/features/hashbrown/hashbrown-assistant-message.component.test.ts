import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import fixtureData from "../../../../../aimock/d6/strands/declarative-hashbrown.json";
import { HashbrownAssistantMessage } from "./hashbrown-assistant-message.component";

const fixtureContent = fixtureData.fixtures[0].response.content;

describe("HashbrownAssistantMessage", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HashbrownAssistantMessage],
      providers: [provideZonelessChangeDetection()],
    });
  });

  it("renders the shared assistant JSON fixture through the official Angular renderer", async () => {
    const fixture = TestBed.createComponent(HashbrownAssistantMessage);
    fixture.componentRef.setInput("message", assistantMessage(fixtureContent));
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector("hb-render-message")).not.toBeNull();
    expect(
      element.querySelectorAll('[data-testid="metric-card"]'),
    ).toHaveLength(2);
    expect(element.querySelector('[data-testid="pie-chart"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="bar-chart"]')).not.toBeNull();
  });

  it("updates progressively as streaming assistant JSON grows", async () => {
    const fixture = TestBed.createComponent(HashbrownAssistantMessage);
    const firstComponentBoundary = fixtureContent.indexOf('},{"metric"');
    const partialContent = `${fixtureContent.slice(0, firstComponentBoundary + 1)}`;

    fixture.componentRef.setInput("message", assistantMessage(partialContent));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="metric-card"]',
      ),
    ).toHaveLength(1);

    fixture.componentRef.setInput("message", assistantMessage(fixtureContent));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="metric-card"]',
      ),
    ).toHaveLength(2);
  });

  it("surfaces schema errors without exposing parser details", async () => {
    const fixture = TestBed.createComponent(HashbrownAssistantMessage);
    fixture.componentRef.setInput(
      "message",
      assistantMessage('{"ui":[{"unknown":{"props":{}}}]}'),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    const alert = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="alert"]',
    );
    expect(alert?.textContent).toContain("could not be rendered");
    expect(alert?.textContent).not.toContain("schema");
  });
});

/** Build the AG-UI assistant-message shape consumed by the chat slot. */
function assistantMessage(content: string): {
  id: string;
  role: "assistant";
  content: string;
} {
  return {
    id: "assistant-1",
    role: "assistant",
    content,
  };
}
