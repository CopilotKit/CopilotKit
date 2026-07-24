import { ApplicationRef, provideZonelessChangeDetection } from "@angular/core";
import type { Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BarChartCard,
  BeautifulToolReasoningCard,
  FlightSearchCard,
  MeetingTimePickerCard,
  PieChartCard,
} from "./beautiful-chat-cards";
import { toggleDocumentTheme } from "./beautiful-chat-model";
import { BeautifulTodoCanvas } from "./beautiful-todo-canvas";
import { readBeautifulTodos } from "./beautiful-todo-canvas";

describe("Angular Beautiful Chat renderers", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("renders probe-compatible accessible pie and bar charts", async () => {
    const args = {
      title: "Revenue",
      description: "By category",
      data: [
        { label: "A", value: 40 },
        { label: "B", value: 30 },
        { label: "C", value: 20 },
        { label: "D", value: 10 },
      ],
    };
    const pie = await render(PieChartCard, {
      toolCall: { name: "pieChart", args, status: "executing" },
    });
    expect(pie.querySelectorAll("svg circle")).toHaveLength(5);
    expect(pie.textContent).toContain("Revenue");

    const bar = await render(BarChartCard, {
      toolCall: { name: "barChart", args, status: "executing" },
    });

    expect(bar.querySelector(".recharts-responsive-container")).not.toBeNull();
    expect(bar.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(4);
  });

  it("resolves the meeting picker and retains its confirmed state", async () => {
    const respond = vi.fn();
    const element = await render(MeetingTimePickerCard, {
      toolCall: {
        name: "scheduleTime",
        args: {
          reasonForScheduling: "Learn about CopilotKit",
          meetingDuration: 30,
        },
        status: "executing",
        respond,
      },
    });

    expect(element.textContent).toContain("Pick a time that works for you");
    element
      .querySelector<HTMLButtonElement>('[data-testid="meeting-slot-tomorrow"]')
      ?.click();
    await TestBed.inject(ApplicationRef).whenStable();
    expect(element.textContent).toContain("Meeting Scheduled");
    expect(respond).toHaveBeenCalledWith(
      "Meeting scheduled for Tomorrow at 2:00 PM (30 min).",
    );
  });

  it("hides internal protocol tools from the flagship fallback", async () => {
    const hidden = await render(BeautifulToolReasoningCard, {
      toolCall: {
        name: "render_a2ui",
        args: {},
        status: "executing",
      },
    });
    expect(hidden.textContent?.trim()).toBe("");

    const visible = await render(BeautifulToolReasoningCard, {
      toolCall: {
        name: "query_data",
        args: { query: "revenue" },
        status: "complete",
        result: "ok",
      },
    });

    expect(visible.textContent).toContain("query_data");
  });

  it("keeps completed fixed-schema flight results visible", async () => {
    const element = await render(FlightSearchCard, {
      toolCall: {
        name: "search_flights",
        args: {
          flights: [
            {
              airline: "United Airlines",
              flightNumber: "UA231",
              origin: "SFO",
              destination: "JFK",
              departureTime: "08:00",
              arrivalTime: "16:30",
              duration: "5h 30m",
              status: "On Time",
              price: "$349",
            },
            {
              airline: "Delta",
              flightNumber: "DL412",
              origin: "SFO",
              destination: "JFK",
              departureTime: "10:15",
              arrivalTime: "18:45",
              duration: "5h 30m",
              status: "On Time",
              price: "$289",
            },
          ],
        },
        status: "complete",
      },
    });

    expect(
      element.querySelector('[data-testid="beautiful-flight-results"]'),
    ).not.toBeNull();
    expect(element.textContent).toContain("United Airlines");
    expect(element.textContent).toContain("$349");
    expect(element.textContent).toContain("Delta");
    expect(element.textContent).toContain("$289");
  });

  it("renders and immutably updates the state-backed task canvas", async () => {
    const todos = [
      {
        id: "read-docs",
        title: "Read the docs",
        description: "Learn the APIs",
        emoji: "📚",
        status: "pending" as const,
      },
    ];
    const changed = vi.fn();
    const element = await render(
      BeautifulTodoCanvas,
      { todos, isRunning: false },
      { todosChange: changed },
    );

    expect(element.textContent).toContain("Read the docs");
    element
      .querySelector<HTMLButtonElement>('[data-testid="todo-toggle-read-docs"]')
      ?.click();
    expect(changed).toHaveBeenCalledWith([
      { ...todos[0], status: "completed" },
    ]);
    expect(todos[0]?.status).toBe("pending");
  });

  it("toggles the document theme and rejects malformed todo state", () => {
    const root = document.createElement("div");
    expect(toggleDocumentTheme(root)).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(toggleDocumentTheme(root)).toBe("light");
    expect(readBeautifulTodos({ todos: [{ id: 42 }] })).toEqual([]);
  });
});

async function render<T>(
  component: Type<T>,
  inputs: Record<string, unknown>,
  outputs: Record<string, (value: unknown) => void> = {},
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
  for (const [name, listener] of Object.entries(outputs)) {
    const instance = fixture.componentRef.instance as Record<
      string,
      { subscribe: (handler: (value: unknown) => void) => unknown }
    >;
    instance[name]?.subscribe(listener);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
