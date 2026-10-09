import { provideZonelessChangeDetection } from "@angular/core";
import type { Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import {
  NotesToolCard,
  ReasoningCatchallToolCard,
  ShowcaseWildcardToolCard,
  WeatherToolCard,
} from "./tool-cards";

describe("Angular showcase tool cards", () => {
  it("renders a named weather tool with the shared probe marker", async () => {
    const element = await render(WeatherToolCard, {
      name: "get_weather",
      args: { location: "Tokyo" },
      status: "complete",
      result: '{"temperature":22}',
    });
    expect(
      element.querySelector('[data-testid="weather-card"]'),
    ).not.toBeNull();
    expect(element.textContent).toContain("Tokyo");
    expect(element.textContent).toContain("22");
  });

  it("identifies every custom wildcard invocation by tool name", async () => {
    const element = await render(ShowcaseWildcardToolCard, {
      name: "get_stock_price",
      args: { ticker: "AAPL" },
      status: "executing",
      result: undefined,
    });
    expect(
      element
        .querySelector('[data-testid="custom-wildcard-card"]')
        ?.getAttribute("data-tool-name"),
    ).toBe("get_stock_price");
  });

  it("uses the reasoning-chain catchall contract without changing the standalone wildcard", async () => {
    const element = await render(ReasoningCatchallToolCard, {
      name: "get_stock_price",
      args: { ticker: "AAPL" },
      status: "complete",
      result: '{"price":210}',
    });

    expect(
      element
        .querySelector('[data-testid="custom-catchall-card"]')
        ?.getAttribute("data-tool-name"),
    ).toBe("get_stock_price");
    expect(
      element.querySelector('[data-testid="custom-wildcard-card"]'),
    ).toBeNull();
  });

  it("renders settled async note results", async () => {
    const element = await render(NotesToolCard, {
      name: "query_notes",
      args: { query: "project planning" },
      status: "complete",
      result: JSON.stringify([{ id: "planning", title: "Project planning" }]),
    });
    expect(element.querySelector('[data-testid="notes-card"]')).not.toBeNull();
    expect(
      element.querySelector('[data-testid="note-planning"]'),
    ).not.toBeNull();
  });
});

async function render<T>(
  component: Type<T>,
  toolCall: Record<string, unknown>,
): Promise<HTMLElement> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(component);
  fixture.componentRef.setInput("toolCall", toolCall);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
