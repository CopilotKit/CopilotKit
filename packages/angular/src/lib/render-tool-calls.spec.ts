import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { AssistantMessage } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { CopilotKit } from "./copilotkit";
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
