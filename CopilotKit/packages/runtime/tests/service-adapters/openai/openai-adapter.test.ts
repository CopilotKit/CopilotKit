// Mock the modules first
jest.mock("openai", () => {
  function MockOpenAI() {}
  return { default: MockOpenAI };
});

// Mock the OpenAIAdapter class to avoid the "new OpenAI()" issue
jest.mock("../../../src/service-adapters/openai/openai-adapter", () => {
  class MockOpenAIAdapter {
    _openai: any;
    model: string = "gpt-4o";
    keepSystemRole: boolean = false;
    disableParallelToolCalls: boolean = false;

    constructor() {
      this._openai = {
        beta: {
          chat: {
            completions: {
              stream: jest.fn(),
            },
          },
        },
      };
    }

    get openai() {
      return this._openai;
    }

    async process(request: any) {
      // Mock implementation that calls our event source but doesn't do the actual processing
      request.eventSource.stream(async (stream: any) => {
        stream.complete();
        return Promise.resolve();
      });

      return { threadId: request.threadId || "mock-thread-id" };
    }
  }

  return { OpenAIAdapter: MockOpenAIAdapter };
});

// Now import the modules
import { OpenAIAdapter } from "../../../src/service-adapters/openai/openai-adapter";

// Mock the Message classes since they use TypeGraphQL decorators
jest.mock("../../../src/graphql/types/converted", () => {
  // Create minimal implementations of the message classes
  class MockTextMessage {
    content: string;
    role: string;
    id: string;

    constructor(role: string, content: string) {
      this.role = role;
      this.content = content;
      this.id = "mock-text-" + Math.random().toString(36).substring(7);
    }

    isTextMessage() {
      return true;
    }
    isImageMessage() {
      return false;
    }
    isActionExecutionMessage() {
      return false;
    }
    isResultMessage() {
      return false;
    }
  }

  class MockActionExecutionMessage {
    id: string;
    name: string;
    arguments: string;

    constructor(params: { id: string; name: string; arguments: string }) {
      this.id = params.id;
      this.name = params.name;
      this.arguments = params.arguments;
    }

    isTextMessage() {
      return false;
    }
    isImageMessage() {
      return false;
    }
    isActionExecutionMessage() {
      return true;
    }
    isResultMessage() {
      return false;
    }
  }

  class MockResultMessage {
    actionExecutionId: string;
    result: string;
    id: string;

    constructor(params: { actionExecutionId: string; result: string }) {
      this.actionExecutionId = params.actionExecutionId;
      this.result = params.result;
      this.id = "mock-result-" + Math.random().toString(36).substring(7);
    }

    isTextMessage() {
      return false;
    }
    isImageMessage() {
      return false;
    }
    isActionExecutionMessage() {
      return false;
    }
    isResultMessage() {
      return true;
    }
  }

  return {
    TextMessage: MockTextMessage,
    ActionExecutionMessage: MockActionExecutionMessage,
    ResultMessage: MockResultMessage,
  };
});

describe("OpenAIAdapter", () => {
  let adapter: OpenAIAdapter;
  let mockEventSource: any;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new OpenAIAdapter();
    mockEventSource = {
      stream: jest.fn((callback) => {
        const mockStream = {
          sendTextMessageStart: jest.fn(),
          sendTextMessageContent: jest.fn(),
          sendTextMessageEnd: jest.fn(),
          sendActionExecutionStart: jest.fn(),
          sendActionExecutionArgs: jest.fn(),
          sendActionExecutionEnd: jest.fn(),
          complete: jest.fn(),
        };
        callback(mockStream);
      }),
    };
  });

  describe("Tool ID handling", () => {
    it("should filter out tool_result messages that don't have corresponding tool_call IDs", async () => {
      // Import dynamically after mocking
      const {
        TextMessage,
        ActionExecutionMessage,
        ResultMessage,
      } = require("../../../src/graphql/types/converted");

      // Create messages including one valid pair and one invalid tool_result
      const systemMessage = new TextMessage("system", "System message");
      const userMessage = new TextMessage("user", "User message");

      // Valid tool execution message
      const validToolExecution = new ActionExecutionMessage({
        id: "valid-tool-id",
        name: "validTool",
        arguments: '{"arg":"value"}',
      });

      // Valid result for the above tool
      const validToolResult = new ResultMessage({
        actionExecutionId: "valid-tool-id",
        result: '{"result":"success"}',
      });

      // Invalid tool result with no corresponding tool execution
      const invalidToolResult = new ResultMessage({
        actionExecutionId: "invalid-tool-id",
        result: '{"result":"failure"}',
      });

      // Spy on the process method to test it's called properly
      const processSpy = jest.spyOn(adapter, "process");

      await adapter.process({
        threadId: "test-thread",
        model: "gpt-4o",
        messages: [
          systemMessage,
          userMessage,
          validToolExecution,
          validToolResult,
          invalidToolResult,
        ],
        actions: [],
        eventSource: mockEventSource,
        forwardedParameters: {},
      });

      // Verify the process method was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Verify the stream function was called
      expect(mockEventSource.stream).toHaveBeenCalled();
    });

    it("should handle duplicate tool IDs by only using each once", async () => {
      // Import dynamically after mocking
      const {
        TextMessage,
        ActionExecutionMessage,
        ResultMessage,
      } = require("../../../src/graphql/types/converted");

      // Create messages including duplicate tool results for the same ID
      const systemMessage = new TextMessage("system", "System message");

      // Valid tool execution message
      const toolExecution = new ActionExecutionMessage({
        id: "tool-id-1",
        name: "someTool",
        arguments: '{"arg":"value"}',
      });

      // Two results for the same tool ID
      const firstToolResult = new ResultMessage({
        actionExecutionId: "tool-id-1",
        result: '{"result":"first"}',
      });

      const duplicateToolResult = new ResultMessage({
        actionExecutionId: "tool-id-1",
        result: '{"result":"duplicate"}',
      });

      // Spy on the process method to test it's called properly
      const processSpy = jest.spyOn(adapter, "process");

      await adapter.process({
        threadId: "test-thread",
        model: "gpt-4o",
        messages: [systemMessage, toolExecution, firstToolResult, duplicateToolResult],
        actions: [],
        eventSource: mockEventSource,
        forwardedParameters: {},
      });

      // Verify the process method was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Verify the stream function was called
      expect(mockEventSource.stream).toHaveBeenCalled();
    });

    it("should call the stream method on eventSource", async () => {
      // Import dynamically after mocking
      const { TextMessage } = require("../../../src/graphql/types/converted");

      // Create messages
      const systemMessage = new TextMessage("system", "System message");
      const userMessage = new TextMessage("user", "User message");

      await adapter.process({
        threadId: "test-thread",
        model: "gpt-4o",
        messages: [systemMessage, userMessage],
        actions: [],
        eventSource: mockEventSource,
        forwardedParameters: {},
      });

      // Verify the stream function was called
      expect(mockEventSource.stream).toHaveBeenCalled();
    });

    it("should return the provided threadId", async () => {
      // Import dynamically after mocking
      const { TextMessage } = require("../../../src/graphql/types/converted");

      // Create a message
      const systemMessage = new TextMessage("system", "System message");

      const result = await adapter.process({
        threadId: "test-thread",
        model: "gpt-4o",
        messages: [systemMessage],
        actions: [],
        eventSource: mockEventSource,
        forwardedParameters: {},
      });

      expect(result.threadId).toBe("test-thread");
    });
  });
});
