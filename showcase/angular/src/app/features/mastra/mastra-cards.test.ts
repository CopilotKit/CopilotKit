import { provideZonelessChangeDetection } from "@angular/core";
import type { Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  BackgroundTaskActivityCard,
  BrowseResultsToolCard,
  ObservationalMemoryActivityCard,
} from "./mastra-cards";

describe("Angular Mastra feature cards", () => {
  afterEach(() => TestBed.resetTestingModule());

  it.each([
    ["running", "Working"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
    ["suspended", "Paused"],
  ])("renders background task status %s", async (status, label) => {
    const element = await render(BackgroundTaskActivityCard, {
      content: {
        status,
        args: { topic: "AI agent frameworks" },
      },
    });

    expect(
      element
        .querySelector('[data-testid="background-task-activity"]')
        ?.getAttribute("data-status"),
    ).toBe(status);
    expect(
      element.querySelector('[data-testid="background-task-status"]')
        ?.textContent,
    ).toContain(label);
    expect(element.textContent).toContain("AI agent frameworks");
  });

  it("renders observational-memory lifecycle and optional details", async () => {
    const element = await render(ObservationalMemoryActivityCard, {
      content: {
        cycleId: "cycle-1",
        phase: "activation",
        status: "activated",
        observations: "The customer values fast analytics.",
        tokensActivated: 420,
      },
    });

    const card = element.querySelector('[data-testid="om-activity-card"]');
    expect(card?.getAttribute("data-om-phase")).toBe("activation");
    expect(card?.getAttribute("data-om-status")).toBe("activated");
    expect(
      element.querySelector('[data-testid="om-status-dot"]'),
    ).not.toBeNull();
    expect(
      element.querySelector('[data-testid="om-observations"]')?.textContent,
    ).toContain("fast analytics");
    expect(element.textContent).toContain("420 tokens activated");
  });

  it.each([
    {
      status: "executing",
      result: undefined,
      expected: "Browsing",
    },
    {
      status: "complete",
      result: JSON.stringify({ error: "Chromium is unavailable" }),
      expected: "Chromium is unavailable",
    },
    {
      status: "complete",
      result: JSON.stringify({
        mode: "hackernews",
        results: [
          {
            title: "An interesting story",
            url: "https://example.com/story",
            points: 42,
            source: "news.ycombinator.com",
          },
        ],
      }),
      expected: "An interesting story",
    },
  ])(
    "renders browser-use state $status",
    async ({ status, result, expected }) => {
      const element = await render(BrowseResultsToolCard, {
        toolCall: {
          name: "browse_web",
          args: { task: "Read the web" },
          status,
          result,
        },
      });

      expect(
        element.querySelector('[data-testid="browse-results-card"]'),
      ).not.toBeNull();
      expect(element.textContent).toContain(expected);
    },
  );
});

async function render<T>(
  component: Type<T>,
  inputs: Record<string, unknown>,
): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
