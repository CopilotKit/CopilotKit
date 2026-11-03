import { Component, input, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import { z } from "zod";

import { CopilotKit } from "../../../copilotkit";
import type { AngularToolCall, RenderToolCallConfig } from "../../../tools";
import { CopilotChatMessageView } from "../copilot-chat-message-view";
import { CopilotChatToolCallsView } from "../copilot-chat-tool-calls-view";
import type { CopilotChatToolCallDisplay } from "../tool-call-layout";
import { provideCopilotChatLabels } from "../../../chat-config";

const question: Message = { id: "u1", role: "user", content: "Why?" };

const callMessage = (id: string, name = "run_command"): AssistantMessage => ({
  id: `m-${id}`,
  role: "assistant",
  content: "",
  toolCalls: [
    {
      id,
      type: "function",
      function: { name, arguments: JSON.stringify({ command: `cmd ${id}` }) },
    },
  ],
});

const result = (id: string, error?: string): ToolMessage => ({
  id: `r-${id}`,
  role: "tool",
  toolCallId: id,
  content: "ok",
  ...(error ? { error } : {}),
});

const say = (id: string, content: string): Message => ({
  id,
  role: "assistant",
  content,
});

@Component({
  template: `
    <div data-testid="weather-card">Weather</div>
  `,
})
class WeatherCard {
  readonly toolCall = input<AngularToolCall>();
}

@Component({
  template: `
    <div data-testid="custom-call">{{ toolCall().name }}</div>
  `,
})
class CustomCall {
  readonly toolCall = input.required<AngularToolCall>();
}

const weather: RenderToolCallConfig = {
  name: "weather",
  args: z.object({}),
  component: WeatherCard,
};

function provideKit(
  renderers: RenderToolCallConfig[] = [weather],
  defaultToolRendering = true,
) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CopilotKit,
        useValue: {
          toolCallRenderConfigs: signal(renderers),
          clientToolCallRenderConfigs: signal([]),
          humanInTheLoopToolRenderConfigs: signal([]),
          activityMessageRenderConfigs: signal([]),
          defaultToolRenderingEnabled: defaultToolRendering,
          getAgent: vi.fn(),
        },
      },
    ],
  });
}

function renderView(
  messages: Message[],
  options: { display?: CopilotChatToolCallDisplay; isRunning?: boolean } = {},
) {
  const fixture = TestBed.createComponent(CopilotChatMessageView);
  fixture.componentRef.setInput("messages", messages);
  fixture.componentRef.setInput("isLoading", options.isRunning ?? false);
  if (options.display) {
    fixture.componentRef.setInput("toolCallDisplay", options.display);
  }
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const group = () =>
    root.querySelector<HTMLElement>('[data-testid="copilot-tool-call-group"]')!;
  const toggle = () => group().querySelector("button")!;
  const click = (button: HTMLElement) => {
    button.click();
    fixture.detectChanges();
  };
  return { fixture, root, group, toggle, click };
}

describe("CopilotChatMessageView toolCallDisplay", () => {
  afterEach(() => TestBed.resetTestingModule());

  const burst = [
    question,
    callMessage("a"),
    result("a"),
    callMessage("b"),
    result("b", "boom"),
    say("t", "Done."),
  ];

  it("groups calls into one collapsed card by default", () => {
    provideKit();
    const { group, toggle, click } = renderView(burst);
    expect(group().getAttribute("data-appearance")).toBe("card");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("Used 2 tools");
    expect(toggle().textContent).toContain("1 failed");

    click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const rows = group().querySelectorAll(
      '[data-testid="copilot-tool-render"]',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.classList).toContain("cpk-tool-call-row-card");
    expect(rows[0]!.getAttribute("data-tool-call-id")).toBe("a");
  });

  it("makes a closed group's rows inert", () => {
    provideKit();
    const { group, toggle, click } = renderView(burst);
    const body = group().querySelector(".cpk-collapsible")!;
    expect(body.hasAttribute("inert")).toBe(true);
    expect(toggle().getAttribute("aria-controls")).toBe(body.id);
    click(toggle());
    expect(body.hasAttribute("inert")).toBe(false);
  });

  it("names the running call while the group is still going", () => {
    provideKit();
    const { group } = renderView(
      [question, callMessage("a"), result("a"), callMessage("b")],
      { isRunning: true },
    );
    expect(group().getAttribute("data-state")).toBe("running");
    expect(group().textContent).toContain("Running run_command");
    expect(group().textContent).toContain("1 done");
  });

  it("shows a group the run left unfinished as stopped, not running", () => {
    provideKit();
    const { group } = renderView([
      question,
      callMessage("a"),
      result("a"),
      callMessage("b"),
    ]);
    expect(group().getAttribute("data-state")).toBe("stopped");
    expect(group().textContent).not.toContain("Running");
    expect(group().textContent).toContain("Stopped");
  });

  it("says how many calls failed instead of Done", () => {
    provideKit();
    const { group, toggle } = renderView(burst);
    expect(group().getAttribute("data-state")).toBe("failed");
    expect(toggle().textContent).toContain("1 failed");
    expect(toggle().textContent).not.toContain("Done");
  });

  it("reads its text from the chat labels", () => {
    provideKit();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotChatLabels({
          toolCallUsedToolsOther: "{count} Tools benutzt",
          toolCallFailedCountLabel: "{count} fehlgeschlagen",
          toolCallStatusFailedLabel: "Fehler",
        }),
      ],
    });
    const { toggle } = renderView(burst);
    expect(toggle().textContent).toContain("2 Tools benutzt");
    expect(toggle().textContent).toContain("1 fehlgeschlagen");
    expect(toggle().textContent).not.toContain("Used");

    const stacked = renderView(burst, { display: "stacked" });
    expect(
      stacked.group().querySelector('[aria-live="polite"]')?.textContent,
    ).toBe("run_command: Fehler");
  });

  it.each([
    ["line", "line"],
    ["stacked", "stack"],
    ["turn", "card"],
  ] as const)("draws %s groups", (display, appearance) => {
    provideKit();
    const { group } = renderView(burst, { display });
    expect(group().getAttribute("data-appearance")).toBe(appearance);
  });

  it("opens a stack into the same compact rows, with Collapse", () => {
    provideKit();
    const { group, toggle, click } = renderView(burst, { display: "stacked" });
    expect(group().querySelector('[aria-live="polite"]')?.textContent).toBe(
      "run_command: Failed",
    );
    toggle().focus();
    click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggle());
    expect(group().textContent).toContain("Collapse");
    const statuses = group().querySelectorAll(
      '[data-testid="copilot-tool-render-status"]',
    );
    expect(statuses).toHaveLength(2);
    for (const status of Array.from(statuses)) {
      expect(status.classList).toContain("cpk-tool-call-row-status");
    }
  });

  it("gives every call its own card with separate", () => {
    provideKit();
    const { root } = renderView(burst, { display: "separate" });
    expect(
      root.querySelector('[data-testid="copilot-tool-call-group"]'),
    ).toBeNull();
    const cards = root.querySelectorAll('[data-testid="copilot-tool-render"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.classList).toContain("cpk-default-tool-call");
  });

  it("keeps calls with their own renderer visible and outside the group", () => {
    provideKit();
    const { root } = renderView([
      question,
      callMessage("a"),
      callMessage("w", "weather"),
      callMessage("b"),
    ]);
    expect(root.querySelector('[data-testid="weather-card"]')).not.toBeNull();
    expect(
      root.querySelectorAll('[data-testid="copilot-tool-call-group"]'),
    ).toHaveLength(2);
  });

  it("leaves calls drawn by a custom catch-all on their own unless it opts in", () => {
    const messages = [question, callMessage("a"), callMessage("b")];
    provideKit([{ name: "*", args: z.object({}), component: CustomCall }]);
    let { root } = renderView(messages);
    expect(
      root.querySelector('[data-testid="copilot-tool-call-group"]'),
    ).toBeNull();
    expect(root.querySelectorAll('[data-testid="custom-call"]')).toHaveLength(
      2,
    );
    TestBed.resetTestingModule();

    provideKit([
      { name: "*", args: z.object({}), component: CustomCall, group: true },
    ]);
    ({ root } = renderView(messages));
    expect(
      root.querySelector('[data-testid="copilot-tool-call-group"]'),
    ).not.toBeNull();
  });
});

describe("CopilotChatToolCallsView on its own", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("shows a call without a result as running, with no run state to say otherwise", () => {
    provideKit();
    const fixture = TestBed.createComponent(CopilotChatToolCallsView);
    fixture.componentRef.setInput("message", callMessage("a"));
    fixture.componentRef.setInput("messages", [question, callMessage("a")]);
    fixture.detectChanges();
    const group = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="copilot-tool-call-group"]',
    )!;
    expect(group.getAttribute("data-state")).toBe("running");
  });
});
