import "reflect-metadata";
import { TextEncoder } from "util";
import { RemoteLangGraphEventSource } from "../../../agents/langgraph/event-source";
import telemetry from "../../telemetry-client";
import {
  constructLGCRemoteAction,
  constructRemoteActions,
  createHeaders,
} from "../remote-action-constructors";
import { execute } from "../remote-lg-action";
import { ReplaySubject } from "rxjs";

// Mock external dependencies
jest.mock("../remote-lg-action", () => ({
  execute: jest.fn(),
}));

jest.mock("../../telemetry-client", () => ({
  capture: jest.fn(),
}));

jest.mock("../../../agents/langgraph/event-source", () => ({
  RemoteLangGraphEventSource: jest.fn(),
}));

// Dummy logger
const logger = {
  debug: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => logger),
};

// Dummy graphqlContext
const graphqlContext = { properties: { dummyProp: "value" } } as any;

// Dummy agent state
const agentStates = [{ agentName: "agent1", state: "{}", configurable: "{}" }];

// Dummy agent used in constructLGCRemoteAction
const dummyAgent = { name: "agent1", description: "test agent" };
const endpoint = {
  agents: [dummyAgent],
  deploymentUrl: "http://dummy.deployment",
  langsmithApiKey: "dummykey",
};

// Clear mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

describe("remote action constructors", () => {
  describe("constructLGCRemoteAction", () => {
    it("should create an agent with remoteAgentHandler that processes events", async () => {
      // Arrange: simulate execute returning a dummy ReadableStream
      const dummyEncodedEvent = new TextEncoder().encode(JSON.stringify({ event: "test" }) + "\n");
      const readerMock = {
        read: jest
          .fn()
          .mockResolvedValueOnce({ done: false, value: dummyEncodedEvent })
          .mockResolvedValueOnce({ done: true, value: new Uint8Array() }),
      };

      const dummyResponse = {
        getReader: () => readerMock,
      };

      (execute as jest.Mock).mockResolvedValue(dummyResponse);

      // Mock RemoteLangGraphEventSource to return a dummy processed result
      const processLangGraphEventsMock = jest.fn(() => "processed events");
      (RemoteLangGraphEventSource as jest.Mock).mockImplementation(() => ({
        eventStream$: { next: jest.fn(), complete: jest.fn(), error: jest.fn() },
        processLangGraphEvents: processLangGraphEventsMock,
      }));

      // Act: build the action and call remoteAgentHandler
      const actions = constructLGCRemoteAction({
        endpoint,
        graphqlContext,
        logger,
        messages: [],
        agentStates,
      });
      expect(actions).toHaveLength(1);
      const action = actions[0];
      expect(action.name).toEqual(dummyAgent.name);

      const result = await action.remoteAgentHandler({
        name: dummyAgent.name,
        actionInputsWithoutAgents: [],
        threadId: "thread1",
        nodeName: "node1",
        additionalMessages: [],
        metaEvents: [],
      });

      // Assert: processLangGraphEvents is called and result returned
      expect(processLangGraphEventsMock).toHaveBeenCalled();
      expect(result).toBe("processed events");

      // Check telemetry.capture was called with agentExecution true
      expect(telemetry.capture).toHaveBeenCalledWith(
        "oss.runtime.remote_action_executed",
        expect.objectContaining({
          agentExecution: true,
          type: "langgraph-platform",
          agentsAmount: 1,
        }),
      );
    });
  });

  describe("constructRemoteActions", () => {
    const json = {
      agents: [{ name: "agent2", description: "agent desc" }],
      actions: [
        {
          name: "action1",
          description: "action desc",
          parameters: { param: "value" },
        },
      ],
    };
    const url = "http://dummy.api";
    const onBeforeRequest = jest.fn(() => ({ headers: { Authorization: "Bearer token" } }));

    it("should create remote action handler that calls fetch and returns the result", async () => {
      // Arrange: mock fetch for action handler
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ result: "action result" }),
      });

      const actionsArray = constructRemoteActions({
        json,
        url,
        onBeforeRequest,
        graphqlContext,
        logger,
        messages: [],
        agentStates,
      });
      // There should be one action (from json.actions) and one agent (from json.agents)
      expect(actionsArray).toHaveLength(2);
      const actionHandler = actionsArray[0].handler;

      const result = await actionHandler({ foo: "bar" });
      expect(result).toEqual("action result");

      expect(global.fetch).toHaveBeenCalledWith(
        `${url}/actions/execute`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer token",
          }),
          body: expect.any(String),
        }),
      );
    });

    it("should create remote agent handler that processes events", async () => {
      const json = {
        agents: [
          {
            name: "agent2",
            description: "agent desc",
            type: "langgraph", // Add type to match RemoteAgentType.LangGraph
          },
        ],
        actions: [
          {
            name: "action1",
            description: "action desc",
            parameters: { param: "value" },
          },
        ],
      };

      const dummyEncodedAgentEvent = new TextEncoder().encode('{"type":"data","content":"test"}\n');

      const mockResponse = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(dummyEncodedAgentEvent);
            controller.close();
          },
        }),
        {
          status: 200,
          statusText: "OK",
          headers: new Headers({
            "content-type": "application/json",
          }),
        },
      );

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const processLangGraphEventsMock = jest.fn().mockResolvedValue("agent events processed");
      (RemoteLangGraphEventSource as jest.Mock).mockImplementation(() => ({
        eventStream$: new ReplaySubject(),
        processLangGraphEvents: processLangGraphEventsMock,
      }));

      const actionsArray = constructRemoteActions({
        json,
        url,
        onBeforeRequest,
        graphqlContext,
        logger,
        messages: [],
        agentStates,
      });

      const remoteAgentHandler = (actionsArray[1] as any).remoteAgentHandler;
      const result = await remoteAgentHandler({
        name: "agent2",
        actionInputsWithoutAgents: [],
        threadId: "thread2",
        nodeName: "node2",
      });

      expect(processLangGraphEventsMock).toHaveBeenCalled();
      expect(result).toBe("agent events processed");
    });
  });

  describe("createHeaders", () => {
    it("should merge headers from onBeforeRequest", () => {
      const onBeforeRequest = jest.fn(() => ({ headers: { "X-Test": "123" } }));
      const headers = createHeaders(onBeforeRequest, graphqlContext);
      expect(headers).toEqual({
        "Content-Type": "application/json",
        "X-Test": "123",
      });
    });

    it("should return only Content-Type if no additional headers", () => {
      const headers = createHeaders(undefined, graphqlContext);
      expect(headers).toEqual({ "Content-Type": "application/json" });
    });
  });
});
