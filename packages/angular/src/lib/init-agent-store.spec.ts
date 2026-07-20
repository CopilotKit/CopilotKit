import { HttpAgent, type HttpAgentConfig } from "@ag-ui/client";
import { Component, EnvironmentInjector, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { provideCopilotKit } from "./config";
import { CopilotKit } from "./copilotkit";
import { initAgentStore } from "./init-agent-store";
import type { AngularToolCall, HumanInTheLoopToolCall } from "./tools";

@Component({ template: `` })
class FlightCardComponent {
  readonly toolCall = input.required<AngularToolCall>();
}

@Component({ template: `` })
class ApprovalComponent {
  readonly toolCall = input.required<HumanInTheLoopToolCall>();
}

class TestHttpAgent extends HttpAgent {}

describe("initAgentStore", () => {
  let copilotKit: CopilotKit;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({})],
    });
    copilotKit = TestBed.inject(CopilotKit);
  });

  function init(config: Partial<Parameters<typeof initAgentStore>[0]> = {}) {
    TestBed.runInInjectionContext(() =>
      initAgentStore({
        agentId: "pilot",
        url: "http://localhost:9000/agent",
        ...config,
      }),
    );
  }

  it("registers a self-managed HttpAgent with a fresh threadId", () => {
    init();

    const agent = copilotKit.getAgent("pilot");

    expect(agent).toBeInstanceOf(HttpAgent);
    expect((agent as HttpAgent).url).toBe("http://localhost:9000/agent");
    expect(agent?.threadId).toBeTruthy();
  });

  it("uses the createAgent factory to map the config onto an agent", () => {
    const createAgent = vi.fn(
      (agentConfig: HttpAgentConfig) => new TestHttpAgent(agentConfig),
    );

    init({ createAgent });

    expect(createAgent).toHaveBeenCalledWith({
      agentId: "pilot",
      url: "http://localhost:9000/agent",
      threadId: expect.any(String),
    });
    expect(copilotKit.getAgent("pilot")).toBeInstanceOf(TestHttpAgent);
  });

  it("keeps previously registered agents when called again", () => {
    init();
    init({ agentId: "copilot", url: "http://localhost:9001/agent" });

    expect(copilotKit.getAgent("pilot")).toBeInstanceOf(HttpAgent);
    expect(copilotKit.getAgent("copilot")).toBeInstanceOf(HttpAgent);
  });

  it("registers tool-call renderers scoped to the agent", () => {
    init({
      renderToolCalls: [
        {
          name: "show_flight",
          args: z.object({ flightId: z.string() }),
          component: FlightCardComponent,
        },
      ],
    });

    const config = copilotKit
      .toolCallRenderConfigs()
      .find((candidate) => candidate.name === "show_flight");

    expect(config?.agentId).toBe("pilot");
    expect(config?.component).toBe(FlightCardComponent);
  });

  it("registers frontend tools scoped to the agent", () => {
    const handler = vi.fn(async () => "ok");

    init({
      frontendTools: [
        {
          name: "load_flights",
          description: "Loads flights.",
          parameters: z.object({ from: z.string() }),
          handler,
        },
      ],
    });

    const config = copilotKit
      .clientToolCallRenderConfigs()
      .find((candidate) => candidate.name === "load_flights");

    expect(config?.agentId).toBe("pilot");
    expect(
      copilotKit.core.getTool({ toolName: "load_flights", agentId: "pilot" }),
    ).toBeTruthy();
  });

  it("registers human-in-the-loop tools scoped to the agent", () => {
    init({
      humanInTheLoop: [
        {
          name: "confirm_booking",
          description: "Asks the user to confirm a booking.",
          parameters: z.object({ flightId: z.string() }),
          component: ApprovalComponent,
        },
      ],
    });

    const config = copilotKit
      .humanInTheLoopToolRenderConfigs()
      .find((candidate) => candidate.name === "confirm_booking");

    expect(config?.agentId).toBe("pilot");
    expect(
      copilotKit.core.getTool({
        toolName: "confirm_booking",
        agentId: "pilot",
      }),
    ).toBeTruthy();
  });

  it("removes registered tools when the injection context is destroyed", () => {
    init({
      renderToolCalls: [
        {
          name: "show_flight",
          args: z.object({}),
          component: FlightCardComponent,
        },
      ],
    });

    TestBed.inject(EnvironmentInjector).destroy();

    expect(
      copilotKit
        .toolCallRenderConfigs()
        .find((candidate) => candidate.name === "show_flight"),
    ).toBeUndefined();
  });
});
