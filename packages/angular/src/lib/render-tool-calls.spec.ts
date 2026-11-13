import { Component, input, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { AssistantMessage, ToolMessage } from "@ag-ui/client";
import { beforeEach, describe, expect, it } from "vitest";

import { CopilotKit } from "./copilotkit";
import { HUMAN_IN_THE_LOOP_ABORTED_MESSAGE } from "./human-in-the-loop-abort";
import type {
  FrontendToolConfig,
  HumanInTheLoopConfig,
  RenderToolCallConfig,
} from "./tools";
import {
  parseToolCallArguments,
  pickToolCallHandler,
  RenderToolCalls,
} from "./render-tool-calls";

@Component({ template: "{{ label }}", standalone: true })
class NamedRenderer {
  protected readonly label = "named";
}

@Component({ template: "{{ label }}", standalone: true })
class ScopedRenderer {
  protected readonly label = "scoped";
}

@Component({ template: "{{ label }}", standalone: true })
class FrontendRenderer {
  protected readonly label = "frontend";
}

@Component({ template: "{{ label }}", standalone: true })
class WildcardRenderer {
  protected readonly label = "wildcard";
}

const application = [
  { name: "weather", component: NamedRenderer },
  { name: "weather", agentId: "agent-a", component: ScopedRenderer },
  { name: "*", component: WildcardRenderer },
] as unknown as RenderToolCallConfig[];
const frontend = [
  { name: "weather", component: FrontendRenderer },
] as unknown as FrontendToolConfig[];

describe("tool renderer precedence", () => {
  it("normalizes malformed and non-object argument streams for safe rendering", () => {
    expect(parseToolCallArguments('{"city":')).toEqual({
      _raw: '{"city":',
    });
    expect(parseToolCallArguments('"Paris"')).toEqual({ _value: "Paris" });
  });

  it("prefers agent-scoped then unscoped named application renderers", () => {
    expect(
      pickToolCallHandler({
        name: "weather",
        agentId: "agent-a",
        application,
        frontend,
        humanInTheLoop: [],
        builtInFallback: false,
      })?.config.component,
    ).toBe(ScopedRenderer);

    expect(
      pickToolCallHandler({
        name: "weather",
        agentId: "agent-b",
        application,
        frontend,
        humanInTheLoop: [],
        builtInFallback: false,
      })?.config.component,
    ).toBe(NamedRenderer);
  });

  it("uses frontend or HITL renderers before a custom wildcard", () => {
    expect(
      pickToolCallHandler({
        name: "weather",
        application: application.filter((config) => config.name === "*"),
        frontend,
        humanInTheLoop: [],
        builtInFallback: false,
      })?.config.component,
    ).toBe(FrontendRenderer);

    const hitl = [
      { name: "approval", component: ScopedRenderer },
    ] as unknown as HumanInTheLoopConfig[];
    expect(
      pickToolCallHandler({
        name: "approval",
        application,
        frontend: [],
        humanInTheLoop: hitl,
        builtInFallback: false,
      })?.config.component,
    ).toBe(ScopedRenderer);
  });

  it("hides unknown tools unless the built-in fallback is explicitly enabled", () => {
    expect(
      pickToolCallHandler({
        name: "unknown",
        application: [],
        frontend: [],
        humanInTheLoop: [],
        builtInFallback: false,
      }),
    ).toBeUndefined();
    expect(
      pickToolCallHandler({
        name: "unknown",
        application: [],
        frontend: [],
        humanInTheLoop: [],
        builtInFallback: true,
      })?.type,
    ).toBe("builtIn");
  });

  it("uses the ambient agent id to select a scoped renderer", () => {
    TestBed.configureTestingModule({
      imports: [RenderToolCalls],
      providers: [
        {
          provide: CopilotKit,
          useValue: {
            toolCallRenderConfigs: signal(application),
            clientToolCallRenderConfigs: signal([]),
            humanInTheLoopToolRenderConfigs: signal([]),
            defaultToolRenderingEnabled: false,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(RenderToolCalls);
    fixture.componentRef.setInput("message", {
      id: "message-1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "tool-1",
          type: "function",
          function: { name: "weather", arguments: "{}" },
        },
      ],
    } satisfies AssistantMessage);
    fixture.componentRef.setInput("messages", []);
    fixture.componentRef.setInput("agentId", "agent-a");

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("scoped");
  });
});

describe("tool call render inputs for a failed call", () => {
  const captured: { toolCall?: unknown } = {};

  /** Renderer that stores the last `toolCall` it was checked with in `captured`. */
  @Component({ template: "", standalone: true })
  class CapturingRenderer {
    readonly toolCall = input.required<unknown>();
    ngDoCheck(): void {
      captured.toolCall = this.toolCall();
    }
  }

  const ABORTED_RESULT = `Error: ${HUMAN_IN_THE_LOOP_ABORTED_MESSAGE}`;

  /** Renders one `approve` call with the given tool message and returns the `toolCall` the renderer got. */
  function renderWithToolMessage(
    configs: {
      application?: unknown[];
      humanInTheLoop?: unknown[];
    },
    toolMessage: { content: string; error?: string },
  ): unknown {
    captured.toolCall = undefined;
    TestBed.configureTestingModule({
      imports: [RenderToolCalls],
      providers: [
        {
          provide: CopilotKit,
          useValue: {
            toolCallRenderConfigs: signal(configs.application ?? []),
            clientToolCallRenderConfigs: signal([]),
            humanInTheLoopToolRenderConfigs: signal(
              configs.humanInTheLoop ?? [],
            ),
            defaultToolRenderingEnabled: false,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(RenderToolCalls);
    fixture.componentRef.setInput("message", {
      id: "message-1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "tool-1",
          type: "function",
          function: { name: "approve", arguments: "{}" },
        },
      ],
    } satisfies AssistantMessage);
    fixture.componentRef.setInput("messages", [
      {
        id: "tool-message-1",
        role: "tool",
        toolCallId: "tool-1",
        ...toolMessage,
      } satisfies ToolMessage,
    ]);
    fixture.detectChanges();
    return captured.toolCall;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it("renders a HITL call restored with a bare error marker as aborted", () => {
    const toolCall = renderWithToolMessage(
      {
        humanInTheLoop: [{ name: "approve", component: CapturingRenderer }],
      },
      { content: ABORTED_RESULT, error: "error" },
    );

    expect(toolCall).toMatchObject({
      status: "complete",
      result: undefined,
      aborted: true,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
    });
  });

  it("renders a HITL answer that reads like the abort text as an answer", () => {
    const toolCall = renderWithToolMessage(
      {
        humanInTheLoop: [{ name: "approve", component: CapturingRenderer }],
      },
      { content: ABORTED_RESULT },
    );

    expect(toolCall).toMatchObject({
      status: "complete",
      result: ABORTED_RESULT,
    });
    expect(toolCall).not.toHaveProperty("aborted");
  });

  it("passes the tool message's error to a tool call renderer", () => {
    const toolCall = renderWithToolMessage(
      { application: [{ name: "approve", component: CapturingRenderer }] },
      { content: "Error: Network down", error: "Network down" },
    );

    expect(toolCall).toMatchObject({
      status: "complete",
      result: "Error: Network down",
      error: "Network down",
    });
  });
});
