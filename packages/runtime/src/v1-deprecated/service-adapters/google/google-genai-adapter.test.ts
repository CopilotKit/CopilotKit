import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import * as langchainMessages from "@langchain/core/messages";

// Create mock ChatGoogle that captures the filtered messages passed to stream()
const mockStream = vi.fn();
const mockBindTools = vi.fn();
const MockChatGoogle = vi.fn();

// The adapter's chainFn uses lazy require() calls for @langchain/google-gauth
// and @langchain/core/messages. Vitest's vi.mock cannot intercept CJS require()
// calls in all environments. Instead, inject mocks directly into Node's require
// cache so that:
// 1. require("@langchain/google-gauth") returns our mock ChatGoogle
// 2. require("@langchain/core/messages") returns the same module instance as
//    the ESM import above, ensuring instanceof checks work correctly
beforeAll(() => {
  mockStream.mockImplementation((messages: any) =>
    Promise.resolve({ filteredMessages: messages }),
  );
  mockBindTools.mockReturnValue({ stream: mockStream });
  MockChatGoogle.mockImplementation(() => ({ bindTools: mockBindTools }));

  const googleAuthPath = require.resolve("@langchain/google-gauth");
  require.cache[googleAuthPath] = {
    id: googleAuthPath,
    filename: googleAuthPath,
    loaded: true,
    exports: { ChatGoogle: MockChatGoogle },
  } as any;

  const messagesPath = require.resolve("@langchain/core/messages");
  require.cache[messagesPath] = {
    id: messagesPath,
    filename: messagesPath,
    loaded: true,
    exports: langchainMessages,
  } as any;
});

afterAll(() => {
  const googleAuthPath = require.resolve("@langchain/google-gauth");
  delete require.cache[googleAuthPath];
  const messagesPath = require.resolve("@langchain/core/messages");
  delete require.cache[messagesPath];
});

import { GoogleGenerativeAIAdapter } from "./google-genai-adapter";

describe("GoogleGenerativeAIAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStream.mockImplementation((messages: any) =>
      Promise.resolve({ filteredMessages: messages }),
    );
    mockBindTools.mockReturnValue({ stream: mockStream });
    MockChatGoogle.mockImplementation(() => ({ bindTools: mockBindTools }));
  });

  it("should filter out empty AIMessages to prevent Gemini validation errors", async () => {
    const adapter = new GoogleGenerativeAIAdapter();

    // Create a mix of messages including an empty AIMessage (the problematic case)
    const messages = [
      new HumanMessage("Hello"),
      new AIMessage(""), // This should be filtered out
      new HumanMessage("How are you?"),
      new AIMessage("I'm doing well!"), // This should be kept
      new SystemMessage("You are a helpful assistant"), // This should be kept
      new AIMessage(""), // Another empty one to filter out
    ];

    // Access the internal chainFn to test the filtering logic
    const chainFnResult = await (adapter as any).options.chainFn({
      messages,
      tools: [],
      threadId: "test-thread",
    });

    // The result should be filtered messages passed to ChatGoogle.stream()
    const { filteredMessages } = chainFnResult;

    // Should only contain non-empty messages
    expect(filteredMessages).toHaveLength(4);
    expect(filteredMessages[0]).toBeInstanceOf(HumanMessage);
    expect(filteredMessages[0].content).toBe("Hello");
    expect(filteredMessages[1]).toBeInstanceOf(HumanMessage);
    expect(filteredMessages[1].content).toBe("How are you?");
    expect(filteredMessages[2]).toBeInstanceOf(AIMessage);
    expect(filteredMessages[2].content).toBe("I'm doing well!");
    expect(filteredMessages[3]).toBeInstanceOf(SystemMessage);
    expect(filteredMessages[3].content).toBe("You are a helpful assistant");
  });

  it("should keep AIMessages with tool_calls even if content is empty", async () => {
    const adapter = new GoogleGenerativeAIAdapter();

    const messagesWithToolCalls = [
      new HumanMessage("Execute a function"),
      new AIMessage({
        content: "", // Empty content but has tool calls
        tool_calls: [
          {
            id: "call_123",
            name: "test_function",
            args: { param: "value" },
          },
        ],
      }),
    ];

    const chainFnResult = await (adapter as any).options.chainFn({
      messages: messagesWithToolCalls,
      tools: [],
      threadId: "test-thread",
    });

    const { filteredMessages } = chainFnResult;

    // Should keep both messages - the AIMessage has tool_calls so it's valid
    expect(filteredMessages).toHaveLength(2);
    expect(filteredMessages[1]).toBeInstanceOf(AIMessage);
    expect(filteredMessages[1].tool_calls).toHaveLength(1);
  });

  it("should keep all non-AIMessage types regardless of content", async () => {
    const adapter = new GoogleGenerativeAIAdapter();

    const messages = [
      new HumanMessage(""), // Empty human message should be kept
      new SystemMessage(""), // Empty system message should be kept
      new AIMessage(""), // Empty AI message should be filtered
    ];

    const chainFnResult = await (adapter as any).options.chainFn({
      messages,
      tools: [],
      threadId: "test-thread",
    });

    const { filteredMessages } = chainFnResult;

    // Should keep HumanMessage and SystemMessage, filter out empty AIMessage
    expect(filteredMessages).toHaveLength(2);
    expect(filteredMessages[0]).toBeInstanceOf(HumanMessage);
    expect(filteredMessages[1]).toBeInstanceOf(SystemMessage);
  });
});
