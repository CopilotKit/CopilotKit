import { GoogleGenerativeAIAdapter } from "./google-genai-adapter";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

// Mock ChatGoogle to capture what messages are passed to it
jest.mock("@langchain/google-gauth", () => ({
  ChatGoogle: jest.fn().mockImplementation(() => ({
    bindTools: jest.fn().mockReturnThis(),
    stream: jest.fn().mockImplementation((messages) => {
      // Return the messages so we can verify filtering
      return Promise.resolve({ filteredMessages: messages });
    }),
  })),
}));

describe("GoogleGenerativeAIAdapter", () => {
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
