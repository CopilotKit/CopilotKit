import { Component, Injector, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CopilotKit } from "./copilotkit";
import { provideCopilotKit } from "./config";
import { HumanInTheLoop } from "./human-in-the-loop";
import {
  GENERATE_SANDBOXED_UI_TOOL_NAME,
  OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
} from "./open-generative-ui";
import { CopilotOpenGenerativeUIActivityRenderer } from "./components/open-generative-ui/open-generative-ui-activity-renderer";
import { CopilotOpenGenerativeUIToolRenderer } from "./components/open-generative-ui/open-generative-ui-tool-renderer";
import { CopilotA2UIActivityRenderer } from "./components/a2ui/a2ui-activity-renderer";
import { CopilotA2UIToolRenderer } from "./components/a2ui/a2ui-tool-renderer";
import {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  RENDER_A2UI_TOOL_NAME,
} from "./components/a2ui/a2ui-tool-types";
import { A2UI_SCHEMA_CONTEXT_DESCRIPTION } from "@copilotkit/a2ui-renderer/web-components";
import {
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  A2UI_DEFAULT_GENERATION_GUIDELINES,
} from "@copilotkit/shared";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";

const mockSubscribe = vi.fn();
const mockAddTool = vi.fn();
const mockRemoveTool = vi.fn();
const mockSetRuntimeUrl = vi.fn();
const mockSetRuntimeTransport = vi.fn();
const mockSetHeaders = vi.fn();
const mockSetCredentials = vi.fn();
const mockSetProperties = vi.fn();
const mockSetAgents = vi.fn();
const mockGetAgent = vi.fn();
const mockGetTool = vi.fn();
const mockAddContext = vi.fn();
const mockRemoveContext = vi.fn();
const mockRegisterThreadStore = vi.fn();
const mockUnregisterThreadStore = vi.fn();

const licenseKey = "ck_pub_" + "a".repeat(32);

let lastCoreInstance: any;
let lastCoreConfig: any;

function recordCoreInstance(core: any): void {
  lastCoreInstance = core;
}

vi.mock("@copilotkit/core", () => {
  const MockCopilotKitCoreRuntimeConnectionStatus = {
    Disconnected: "disconnected",
    Connected: "connected",
    Connecting: "connecting",
    Error: "error",
  } as const;

  class MockCopilotKitCore {
    readonly subscribe = mockSubscribe;
    readonly addTool = mockAddTool;
    readonly removeTool = mockRemoveTool;
    readonly setRuntimeTransport = mockSetRuntimeTransport;
    readonly setHeaders = mockSetHeaders;
    readonly setCredentials = mockSetCredentials;
    readonly setProperties = mockSetProperties;
    readonly setAgents__unsafe_dev_only = mockSetAgents;
    readonly getAgent = mockGetAgent;
    readonly getTool = mockGetTool;
    readonly addContext = mockAddContext;
    readonly removeContext = mockRemoveContext;
    readonly registerThreadStore = mockRegisterThreadStore;
    readonly unregisterThreadStore = mockUnregisterThreadStore;
    agents: Record<string, any> = {};
    runtimeUrl: string | undefined = undefined;
    runtimeTransport = "auto";
    headers: Record<string, string> = {};
    credentials: RequestCredentials | undefined = undefined;
    intelligence?: { wsUrl: string };
    threadEndpoints?: {
      list: boolean;
      inspect: boolean;
      mutations: boolean;
      realtimeMetadata: boolean;
    };
    a2uiEnabled = false;
    openGenerativeUIEnabled = false;
    runtimeConnectionStatus =
      MockCopilotKitCoreRuntimeConnectionStatus.Disconnected;
    listener?: Parameters<typeof mockSubscribe>[0];

    constructor(config: any) {
      lastCoreConfig = config;
      recordCoreInstance(this);
      this.runtimeUrl = config.runtimeUrl?.replace(/\/$/, "");
      this.headers = config.headers ?? {};
      this.credentials = config.credentials;
      mockSubscribe.mockImplementationOnce((listener: any) => {
        this.listener = listener;
        return { unsubscribe: vi.fn() };
      });
      mockAddContext.mockImplementation(
        () => `ctx-${mockAddContext.mock.calls.length}`,
      );
    }

    setRuntimeUrl(runtimeUrl: string | undefined) {
      mockSetRuntimeUrl(runtimeUrl);
      this.runtimeUrl = runtimeUrl?.replace(/\/$/, "");
    }
  }

  return {
    CopilotKitCore: MockCopilotKitCore,
    CopilotKitCoreRuntimeConnectionStatus:
      MockCopilotKitCoreRuntimeConnectionStatus,
  } as any;
});

describe("CopilotKit", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    document.getElementById("copilotkit-license-watermark")?.remove();
    (globalThis as any).__copilotkitAngularLicenseWatermarkLogged = undefined;
  });

  it("initialises core with transformed tool and renderer config", () => {
    @Component({
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
          licenseKey,
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
      "X-CopilotCloud-Public-Api-Key": licenseKey,
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
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    const injector = TestBed.inject(Injector);

    copilotKit.addFrontendTool({
      name: "client",
      description: "Client tool",
      args: z.object({ value: z.string() }),
      component: class {
        toolCall = signal({} as any);
      },
      handler: handlerSpy,
      injector,
    });

    expect(mockAddTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "client" }),
    );
    expect(copilotKit.clientToolCallRenderConfigs()).toHaveLength(1);

    const tool = mockAddTool.mock.calls.at(-1)![0];
    const mockAgent = { agentId: "test-agent" };
    const mockContext = {
      toolCall: { id: "call-1", function: { name: "client" } },
      agent: mockAgent,
    };
    await tool.handler({ value: "ok" }, mockContext);
    expect(handlerSpy).toHaveBeenCalledWith({ value: "ok" }, mockContext);
  });

  it("registers human-in-the-loop tools and delegates responses", async () => {
    const onResultSpy = vi
      .spyOn(HumanInTheLoop.prototype, "onResult")
      .mockResolvedValue("result");

    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotKit = TestBed.inject(CopilotKit);

    const toolConfig = {
      name: "approval",
      args: z.object({ summary: z.string() }),
      component: class {
        toolCall = signal({} as any);
      },
      toolCall: vi.fn(),
      agentId: "agent-1",
    } as const;

    copilotKit.addHumanInTheLoop(toolConfig);

    expect(copilotKit.humanInTheLoopToolRenderConfigs()).toEqual([toolConfig]);
    expect(mockAddTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "approval" }),
    );

    const tool = mockAddTool.mock.calls.at(-1)![0];
    const mockAgent = { agentId: "agent-1" };
    await tool.handler(
      {},
      {
        toolCall: { id: "call-1", function: { name: "approval" } },
        agent: mockAgent,
      },
    );
    expect(onResultSpy).toHaveBeenCalledWith("call-1", "approval");

    onResultSpy.mockRestore();
  });

  it("registers Open Generative UI tool, activity renderer, and contexts", async () => {
    const sandboxHandler = vi.fn().mockResolvedValue("dark");

    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          licenseKey,
          openGenerativeUI: {
            designSkill: "Use compact dashboard styling.",
            sandboxFunctions: [
              {
                name: "setTheme",
                description: "Set the active theme",
                parameters: z.object({ theme: z.string() }),
                handler: sandboxHandler,
              },
            ],
          },
        }),
      ],
    });

    const copilotKit = TestBed.inject(CopilotKit);

    expect(mockAddTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_SANDBOXED_UI_TOOL_NAME,
        component: CopilotOpenGenerativeUIToolRenderer,
        followUp: true,
      }),
    );
    expect(copilotKit.clientToolCallRenderConfigs()).toEqual([
      expect.objectContaining({
        name: GENERATE_SANDBOXED_UI_TOOL_NAME,
        component: CopilotOpenGenerativeUIToolRenderer,
        followUp: true,
      }),
    ]);
    expect(copilotKit.activityMessageRenderConfigs()).toEqual([
      expect.objectContaining({
        activityType: OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
        component: CopilotOpenGenerativeUIActivityRenderer,
      }),
    ]);

    expect(mockAddContext).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "Design guidelines for the generateSandboxedUi tool. Follow these when building UI.",
        value: "Use compact dashboard styling.",
      }),
    );
    expect(mockAddContext).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "Sandbox functions available in generated sandboxed UI code. Call via: await Websandbox.connection.remote.<functionName>(args)",
        value: expect.stringContaining('"setTheme"'),
      }),
    );

    const tool = mockAddTool.mock.calls.at(-1)![0];
    const result = await tool.handler(
      { initialHeight: 200 },
      {
        toolCall: {
          id: "call-1",
          function: { name: GENERATE_SANDBOXED_UI_TOOL_NAME },
        },
        agent: { agentId: "agent-1" },
      },
    );
    expect(result).toBe("UI generated");
  });

  it("enables built-in A2UI renderers and contexts from runtime capability", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    const core = lastCoreInstance!;

    expect(copilotKit.activityMessageRenderConfigs()).toEqual([]);
    expect(copilotKit.toolCallRenderConfigs()).toEqual([]);

    core.a2uiEnabled = true;
    core.listener!.onRuntimeConnectionStatusChanged({
      status: "connected",
    });

    expect(copilotKit.activityMessageRenderConfigs()).toEqual([
      expect.objectContaining({
        activityType: "a2ui-surface",
        component: CopilotA2UIActivityRenderer,
      }),
    ]);
    expect(copilotKit.toolCallRenderConfigs()).toEqual([
      expect.objectContaining({
        name: RENDER_A2UI_TOOL_NAME,
        component: CopilotA2UIToolRenderer,
        passAgent: true,
      }),
      expect.objectContaining({
        name: AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
        component: CopilotA2UIToolRenderer,
        passAgent: true,
      }),
    ]);
    expect(mockAddContext).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.",
        value: expect.stringContaining("Available A2UI catalog:"),
      }),
    );
    expect(mockAddContext).toHaveBeenCalledWith(
      expect.objectContaining({
        description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
        value: expect.stringContaining('"catalogId"'),
      }),
    );
    expect(mockAddContext).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.",
        value: A2UI_DEFAULT_GENERATION_GUIDELINES,
      }),
    );
    expect(mockAddContext).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.",
        value: A2UI_DEFAULT_DESIGN_GUIDELINES,
      }),
    );
  });

  it("removes tools and renderer configs", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotKit = TestBed.inject(CopilotKit);

    copilotKit.addRenderToolCall({
      name: "temp",
      args: z.object({}),
      component: class {
        toolCall = signal({} as any);
      },
      agentId: undefined,
    });

    copilotKit.removeTool("temp");

    expect(mockRemoveTool).toHaveBeenCalledWith("temp", undefined);
    expect(copilotKit.toolCallRenderConfigs()).toEqual([]);
  });

  it("updates runtime configuration via core methods", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotKit = TestBed.inject(CopilotKit);

    (
      copilotKit.updateRuntime as (
        options: Parameters<CopilotKit["updateRuntime"]>[0] & {
          credentials?: RequestCredentials;
        },
      ) => void
    )({
      runtimeUrl: "https://other/",
      runtimeTransport: "single",
      headers: { Authorization: "different" },
      credentials: "include",
      properties: { locale: "en" },
      agents: { a: {} as any },
    });

    expect(mockSetRuntimeUrl).toHaveBeenCalledWith("https://other/");
    expect(copilotKit.runtimeUrl()).toBe("https://other");
    expect(mockSetRuntimeTransport).toHaveBeenCalledWith("single");
    expect(mockSetHeaders).toHaveBeenCalledWith({ Authorization: "different" });
    expect(mockSetCredentials).toHaveBeenCalledWith("include");
    expect(copilotKit.credentials()).toBe("include");
    expect(mockSetProperties).toHaveBeenCalledWith({ locale: "en" });
    expect(mockSetAgents).toHaveBeenCalledWith({ a: {} });
  });

  it("clears runtime credentials when updateRuntime receives an explicit undefined value", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey, credentials: "include" })],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    expect(copilotKit.credentials()).toBe("include");

    copilotKit.updateRuntime({ credentials: undefined });

    expect(mockSetCredentials).toHaveBeenCalledWith(undefined);
    expect(copilotKit.credentials()).toBeUndefined();
  });

  it("mirrors direct core credential updates into the Angular signal", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    const core = lastCoreInstance!;

    core.credentials = "include";
    core.listener!.onCredentialsChanged({
      credentials: "include",
    });

    expect(copilotKit.credentials()).toBe("include");
  });

  it("reflects agent updates from core subscriptions", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    const core = lastCoreInstance!;

    core.agents = {
      agent1: { id: "agent1" },
    } as any;

    core.listener!.onAgentsChanged();
    expect(copilotKit.agents()).toEqual(core.agents);
  });

  it("mirrors thread runtime info and delegates thread-store registration", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ licenseKey })],
    });

    const copilotKit = TestBed.inject(CopilotKit);
    const core = lastCoreInstance!;
    const threadStore = { start: vi.fn() } as any;

    core.intelligence = { wsUrl: "wss://runtime.local/client" };
    core.threadEndpoints = {
      list: true,
      inspect: true,
      mutations: false,
      realtimeMetadata: true,
    };
    core.listener!.onRuntimeConnectionStatusChanged({
      status: CopilotKitCoreRuntimeConnectionStatus.Connected,
    });

    expect(copilotKit.intelligence()).toEqual({
      wsUrl: "wss://runtime.local/client",
    });
    expect(copilotKit.threadEndpoints()).toEqual({
      list: true,
      inspect: true,
      mutations: false,
      realtimeMetadata: true,
    });

    copilotKit.registerThreadStore("agent-1", threadStore);
    copilotKit.unregisterThreadStore("agent-1");

    expect(mockRegisterThreadStore).toHaveBeenCalledWith(
      "agent-1",
      threadStore,
    );
    expect(mockUnregisterThreadStore).toHaveBeenCalledWith(
      "agent-1",
      undefined,
    );
  });

  it("does not add a watermark when license key is missing (watermark disabled)", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotKit({ runtimeUrl: "https://runtime.local" })],
    });

    TestBed.inject(CopilotKit);

    expect(document.getElementById("copilotkit-license-watermark")).toBeNull();
  });
});
