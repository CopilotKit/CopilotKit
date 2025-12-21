import { Component, Injector, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CopilotKit } from "./copilotkit";
import { provideCopilotKit } from "./config";
import { HumanInTheLoop } from "./human-in-the-loop";

const mockSubscribe = vi.fn();
const mockAddTool = vi.fn();
const mockRemoveTool = vi.fn();
const mockSetRuntimeUrl = vi.fn();
const mockSetHeaders = vi.fn();
const mockSetProperties = vi.fn();
const mockSetAgents = vi.fn();
const mockGetAgent = vi.fn();

let lastCoreInstance: any;
let lastCoreConfig: any;

vi.mock("@copilotkitnext/core", () => {
  class MockCopilotKitCore {
    readonly subscribe = mockSubscribe;
    readonly addTool = mockAddTool;
    readonly removeTool = mockRemoveTool;
    readonly setRuntimeUrl = mockSetRuntimeUrl;
    readonly setHeaders = mockSetHeaders;
    readonly setProperties = mockSetProperties;
    readonly setAgents__unsafe_dev_only = mockSetAgents;
    readonly getAgent = mockGetAgent;
    agents: Record<string, any> = {};
    listener?: Parameters<typeof mockSubscribe>[0];

    constructor(config: any) {
      lastCoreConfig = config;
      lastCoreInstance = this;
      mockSubscribe.mockImplementationOnce((listener: any) => {
        this.listener = listener;
        return { unsubscribe: vi.fn() };
      });
    }
  }

  return { CopilotKitCore: MockCopilotKitCore } as any;
});

describe("CopilotKit", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it("initialises core with transformed tool and renderer config", () => {
    @Component({
      standalone: true,
      selector: "dummy-tool",
      template: "",
    })
    class DummyToolComponent {
      toolCall = signal({} as any);
    }

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          runtimeUrl: "https://runtime.local",
          headers: { Authorization: "token" },
          properties: { region: "eu" },
          tools: [
            {
              name: "search",
              description: "Search something",
              parameters: z.object({ query: z.string() }),
              handler: async () => "done",
              renderer: DummyToolComponent,
            },
          ],
          renderToolCalls: [
            {
              name: "custom",
              args: z.object({ query: z.string() }),
              component: DummyToolComponent,
              agentId: "agent-a",
            },
          ],
        }),
      ],
    });

    const copilotKit = TestBed.inject(CopilotKit);

    expect(lastCoreConfig.runtimeUrl).toBe("https://runtime.local");
    expect(lastCoreConfig.headers).toEqual({
      Authorization: "token",
    });
    expect(lastCoreConfig.tools).toEqual([
      expect.objectContaining({
        name: "search",
        description: "Search something",
        parameters: expect.anything(),
        handler: expect.any(Function),
        renderer: DummyToolComponent,
      }),
    ]);

    expect(copilotKit.toolCallRenderConfigs()).toEqual([
      {
        name: "custom",
        args: expect.anything(),
        component: DummyToolComponent,
        agentId: "agent-a",
      },
      {
        name: "search",
        args: expect.anything(),
        component: DummyToolComponent,
        agentId: undefined,
      },
    ]);
  });

  it("tracks client tools and executes handlers within injection context", async () => {
    const handlerSpy = vi.fn().mockResolvedValue("handled");
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({})],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    const injector = TestBed.inject(Injector);

    copilotKit.addFrontendTool({
      name: "client",
      description: "Client tool",
      args: z.object({ value: z.string() }),
      component: class { toolCall = signal({} as any); },
      handler: handlerSpy,
      injector,
    });

    expect(mockAddTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "client" })
    );
    expect(copilotKit.clientToolCallRenderConfigs()).toHaveLength(1);

    const tool = mockAddTool.mock.calls.at(-1)![0];
    await tool.handler({ value: "ok" });
    expect(handlerSpy).toHaveBeenCalledWith({ value: "ok" });
  });

  it("registers human-in-the-loop tools and delegates responses", async () => {
    const onResultSpy = vi
      .spyOn(HumanInTheLoop.prototype, "onResult")
      .mockResolvedValue("result");

    TestBed.configureTestingModule({
      providers: [provideCopilotKit({})],
    });

    const copilotKit = TestBed.inject(CopilotKit);

    const toolConfig = {
      name: "approval",
      args: z.object({ summary: z.string() }),
      component: class { toolCall = signal({} as any); },
      toolCall: vi.fn(),
      agentId: "agent-1",
    } as const;

    copilotKit.addHumanInTheLoop(toolConfig);

    expect(copilotKit.humanInTheLoopToolRenderConfigs()).toEqual([
      toolConfig,
    ]);
    expect(mockAddTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "approval" })
    );

    const tool = mockAddTool.mock.calls.at(-1)![0];
    await tool.handler({}, { id: "call-1", function: { name: "approval" } });
    expect(onResultSpy).toHaveBeenCalledWith("call-1", "approval");

    onResultSpy.mockRestore();
  });

  it("removes tools and renderer configs", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({})],
    });

    const copilotKit = TestBed.inject(CopilotKit);

    copilotKit.addRenderToolCall({
      name: "temp",
      args: z.object({}),
      component: class { toolCall = signal({} as any); },
      agentId: undefined,
    });

    copilotKit.removeTool("temp");

    expect(mockRemoveTool).toHaveBeenCalledWith("temp");
    expect(copilotKit.toolCallRenderConfigs()).toEqual([]);
  });

  it("updates runtime configuration via core methods", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({})],
    });

    const copilotKit = TestBed.inject(CopilotKit);

    copilotKit.updateRuntime({
      runtimeUrl: "https://other",
      headers: { Authorization: "different" },
      properties: { locale: "en" },
      agents: { a: {} as any },
    });

    expect(mockSetRuntimeUrl).toHaveBeenCalledWith("https://other");
    expect(mockSetHeaders).toHaveBeenCalledWith({ Authorization: "different" });
    expect(mockSetProperties).toHaveBeenCalledWith({ locale: "en" });
    expect(mockSetAgents).toHaveBeenCalledWith({ a: {} });
  });

  it("reflects agent updates from core subscriptions", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({})],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    const core = lastCoreInstance!;

    core.agents = {
      agent1: { id: "agent1" },
    } as any;

    core.listener!.onAgentsChanged();
    expect(copilotKit.agents()).toEqual(core.agents);
  });
});
