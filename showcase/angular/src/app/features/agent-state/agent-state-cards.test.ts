import { provideZonelessChangeDetection } from "@angular/core";
import type { Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentStateCardComponent,
  SubAgentActivityCard,
} from "./agent-state-cards";

describe("Angular agent-state cards", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("renders streamed plan steps through the shared probe contract", async () => {
    const element = await render(AgentStateCardComponent, {
      steps: [
        { id: "one", title: "Research market", status: "completed" },
        { id: "two", title: "Draft launch brief", status: "in_progress" },
      ],
      isRunning: true,
    });
    expect(
      element.querySelector('[data-testid="agent-state-card"]'),
    ).not.toBeNull();
    expect(element.querySelectorAll('[data-testid="agent-step"]')).toHaveLength(
      2,
    );
    expect(element.textContent).toContain("Step 2 of 2");
  });

  it.each([
    ["research_agent", "subagent-card-researcher"],
    ["writing_agent", "subagent-card-writer"],
    ["critique_agent", "subagent-card-critic"],
  ])("renders a distinct supervisor tool card", async (name, testId) => {
    const element = await render(SubAgentActivityCard, {
      toolCall: {
        name,
        args: { task: "Complete the assigned work" },
        status: "complete",
        result: "Finished result",
      },
    });
    expect(element.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    expect(element.textContent).toContain("Finished result");
  });
});

async function render<T>(
  component: Type<T>,
  inputs: Record<string, unknown>,
): Promise<HTMLElement> {
  TestBed.resetTestingModule();
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
