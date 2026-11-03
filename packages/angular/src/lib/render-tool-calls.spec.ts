import { Component, input, signal } from "@angular/core";
import type { Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { AssistantMessage } from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CopilotKit } from "./copilotkit";
import type {
  AngularToolCall,
  FrontendToolConfig,
  HumanInTheLoopConfig,
  HumanInTheLoopToolCall,
  HumanInTheLoopToolRenderer,
  RenderToolCallConfig,
  ToolRenderer,
} from "./tools";
import {
  parseToolCallArguments,
  pickToolCallHandler,
  RenderToolCalls,
} from "./render-tool-calls";

@Component({ template: "{{ label }}", standalone: true })
class NamedRenderer {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly label = "named";
}

@Component({ template: "{{ label }}", standalone: true })
class ScopedRenderer {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly label = "scoped";
}

@Component({ template: "{{ label }}", standalone: true })
class FrontendRenderer {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly label = "frontend";
}

@Component({ template: "{{ label }}", standalone: true })
class WildcardRenderer {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly label = "wildcard";
}

@Component({ template: "{{ label }}", standalone: true })
class ApprovalRenderer {
  readonly toolCall = input.required<HumanInTheLoopToolCall>();
  protected readonly label = "approval";
}

const noArgs = z.object({});

function renderer(
  name: string,
  component: Type<ToolRenderer>,
  agentId?: string,
): RenderToolCallConfig {
  return { name, args: noArgs, component, agentId };
}

function frontendTool(
  name: string,
  component: Type<ToolRenderer>,
  agentId?: string,
): FrontendToolConfig {
  return { name, description: name, parameters: noArgs, component, agentId };
}

function humanInTheLoopTool(
  name: string,
  component: Type<HumanInTheLoopToolRenderer>,
): HumanInTheLoopConfig {
  return { name, description: name, parameters: noArgs, component };
}

/** Which component draws `name` for `agentId`, with no built-in fallback. */
function pickComponent(options: {
  name: string;
  agentId?: string;
  application?: RenderToolCallConfig[];
  frontend?: FrontendToolConfig[];
  humanInTheLoop?: HumanInTheLoopConfig[];
}) {
  return pickToolCallHandler({
    application: [],
    frontend: [],
    humanInTheLoop: [],
    builtInFallback: false,
    ...options,
  })?.config.component;
}

const application = [
  renderer("weather", NamedRenderer),
  renderer("weather", ScopedRenderer, "agent-a"),
  renderer("*", WildcardRenderer),
];
const frontend = [frontendTool("weather", FrontendRenderer)];

describe("tool renderer precedence", () => {
  it("normalizes malformed and non-object argument streams for safe rendering", () => {
    expect(parseToolCallArguments('{"city":')).toEqual({
      _raw: '{"city":',
    });
    expect(parseToolCallArguments('"Paris"')).toEqual({ _value: "Paris" });
  });

  it("prefers agent-scoped then unscoped named application renderers", () => {
    expect(
      pickComponent({ name: "weather", agentId: "agent-a", application }),
    ).toBe(ScopedRenderer);
    expect(
      pickComponent({ name: "weather", agentId: "agent-b", application }),
    ).toBe(NamedRenderer);
  });

  it("uses frontend or HITL renderers before a custom wildcard", () => {
    const wildcardOnly = [renderer("*", WildcardRenderer)];

    expect(
      pickComponent({ name: "weather", application: wildcardOnly, frontend }),
    ).toBe(FrontendRenderer);
    expect(
      pickComponent({
        name: "approval",
        application: wildcardOnly,
        humanInTheLoop: [humanInTheLoopTool("approval", ApprovalRenderer)],
      }),
    ).toBe(ApprovalRenderer);
  });

  it("prefers a frontend tool scoped to the agent over a global application renderer", () => {
    expect(
      pickComponent({
        name: "weather",
        agentId: "agent-a",
        application: [renderer("weather", NamedRenderer)],
        frontend: [frontendTool("weather", FrontendRenderer, "agent-a")],
      }),
    ).toBe(FrontendRenderer);
  });

  it("falls back to a renderer from another agent before the wildcard", () => {
    expect(
      pickComponent({
        name: "weather",
        agentId: "agent-a",
        application: [
          renderer("*", WildcardRenderer),
          renderer("weather", ScopedRenderer, "agent-b"),
        ],
      }),
    ).toBe(ScopedRenderer);
  });

  it("uses a wildcard renderer scoped to another agent", () => {
    expect(
      pickComponent({
        name: "unknown",
        agentId: "agent-a",
        application: [renderer("*", WildcardRenderer, "agent-b")],
      }),
    ).toBe(WildcardRenderer);
  });

  it("hides unknown tools unless the built-in fallback is explicitly enabled", () => {
    const empty = {
      name: "unknown",
      application: [],
      frontend: [],
      humanInTheLoop: [],
    };

    expect(
      pickToolCallHandler({ ...empty, builtInFallback: false }),
    ).toBeUndefined();
    expect(pickToolCallHandler({ ...empty, builtInFallback: true })?.type).toBe(
      "builtIn",
    );
  });

  describe("RenderToolCalls", () => {
    function renderWeatherCall(
      renderers: RenderToolCallConfig[],
      agentId: string | undefined,
    ) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [RenderToolCalls],
        providers: [
          {
            provide: CopilotKit,
            useValue: {
              toolCallRenderConfigs: signal(renderers),
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
      fixture.componentRef.setInput("agentId", agentId);
      fixture.detectChanges();
      return fixture.nativeElement.textContent;
    }

    it("uses the ambient agent id to select a scoped renderer", () => {
      expect(renderWeatherCall(application, "agent-a")).toContain("scoped");
    });

    it("looks up renderers for the default agent when the chat names none", () => {
      const renderers = [
        renderer("weather", NamedRenderer),
        renderer("weather", ScopedRenderer, DEFAULT_AGENT_ID),
      ];

      expect(renderWeatherCall(renderers, undefined)).toContain("scoped");
    });
  });
});
