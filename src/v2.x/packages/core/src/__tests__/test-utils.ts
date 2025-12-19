import { Message } from "@ag-ui/client";
import { vi } from "vitest";
import { DynamicSuggestionsConfig, FrontendTool } from "../types";

export interface MockAgentOptions {
  messages?: Message[];
  newMessages?: Message[];
  error?: Error | string;
  runAgentDelay?: number;
  runAgentCallback?: (input: any) => void;
  agentId?: string;
  threadId?: string;
  state?: Record<string, any>;
}

export class MockAgent {
  public messages: Message[] = [];
  public state: Record<string, any> = {};
  public agentId?: string;
  public threadId?: string;
  public addMessages = vi.fn((messages: Message[]) => {
    this.messages.push(...messages);
  });
  public addMessage = vi.fn((message: Message) => {
    this.messages.push(message);
    // Also track on parent if this is a clone
    if (this._parentAgent) {
      this._parentAgent.addMessage(message);
    }
  });
  public abortRun = vi.fn();
  public clone = vi.fn(() => this._cloneImpl());

  private newMessages: Message[];
  private error?: Error | string;
  private runAgentDelay: number;
  public runAgentCallback?: (input: any) => void;
  public runAgentCalls: any[] = [];
  private _parentAgent?: MockAgent;

  constructor(options: MockAgentOptions = {}) {
    this.messages = options.messages || [];
    this.newMessages = options.newMessages || [];
    this.error = options.error;
    this.runAgentDelay = options.runAgentDelay || 0;
    this.runAgentCallback = options.runAgentCallback;
    this.agentId = options.agentId;
    this.threadId = options.threadId;
    this.state = options.state || {};
  }

  async runAgent(input: any, subscriber?: any): Promise<{ newMessages: Message[] }> {
    this.runAgentCalls.push(input);
    // Also track on parent if this is a clone
    if (this._parentAgent) {
      this._parentAgent.runAgentCalls.push(input);
    }

    if (this.runAgentCallback) {
      this.runAgentCallback(input);
    }

    if (this.runAgentDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.runAgentDelay));
    }

    if (this.error) {
      throw this.error;
    }

    // If there's a subscriber with onMessagesChanged, call it with the messages
    if (subscriber?.onMessagesChanged && this.newMessages.length > 0) {
      // Trigger the subscriber callback with messages
      subscriber.onMessagesChanged({ messages: [...this.messages, ...this.newMessages] });
    }

    return { newMessages: this.newMessages };
  }

  private _cloneImpl(): MockAgent {
    const cloned = new MockAgent({
      messages: [...this.messages],
      newMessages: [...this.newMessages],
      error: this.error,
      runAgentDelay: this.runAgentDelay,
      runAgentCallback: this.runAgentCallback,
      agentId: this.agentId,
      threadId: this.threadId,
      state: JSON.parse(JSON.stringify(this.state)),
    });
    // Link the clone back to the parent so calls are visible
    cloned._parentAgent = this;
    return cloned;
  }

  // Provide a no-op subscribe API so core can attach state listeners
  // without errors during tests.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public subscribe(_subscriber?: any): { unsubscribe: () => void } {
    return { unsubscribe: () => {} };
  }

  setNewMessages(messages: Message[]): void {
    this.newMessages = messages;
  }
}

export function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Math.random().toString(36).substr(2, 9)}`,
    role: "user",
    content: "Test message",
    ...overrides,
  } as Message;
}

export function createAssistantMessage(
  overrides: Partial<Message> = {}
): Message {
  return createMessage({
    role: "assistant",
    content: "Assistant message",
    ...overrides,
  });
}

export function createToolCallMessage(
  toolCallName: string,
  args: any = {},
  overrides: Partial<Message> = {}
): Message {
  const toolCallId = `tool-call-${Math.random().toString(36).substr(2, 9)}`;
  return createAssistantMessage({
    content: "",
    toolCalls: [
      {
        id: toolCallId,
        type: "function",
        function: {
          name: toolCallName,
          arguments: JSON.stringify(args),
        },
      },
    ],
    ...overrides,
  });
}

export function createToolResultMessage(
  toolCallId: string,
  content: string,
  overrides: Partial<Message> = {}
): Message {
  return createMessage({
    role: "tool",
    content,
    toolCallId,
    ...overrides,
  });
}

export function createTool<T extends Record<string, unknown>>(
  overrides: Partial<FrontendTool<T>> = {}
): FrontendTool<T> {
  return {
    name: `tool-${Math.random().toString(36).substr(2, 9)}`,
    description: "Test tool",
    handler: vi.fn(async () => "Tool result"),
    followUp: false, // Default to false to avoid unexpected recursion in tests
    ...overrides,
  };
}

export function createMultipleToolCallsMessage(
  toolCalls: Array<{ name: string; args?: any }>,
  overrides: Partial<Message> = {}
): Message {
  return createAssistantMessage({
    content: "",
    toolCalls: toolCalls.map((tc) => ({
      id: `tool-call-${Math.random().toString(36).substr(2, 9)}`,
      type: "function",
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.args || {}),
      },
    })),
    ...overrides,
  });
}

export async function waitForCondition(
  condition: () => boolean,
  timeout: number = 1000,
  interval: number = 10
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error("Timeout waiting for condition");
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Helper to create a dynamic suggestions config
 */
export function createSuggestionsConfig(
  overrides: Partial<DynamicSuggestionsConfig> = {}
): DynamicSuggestionsConfig {
  return {
    instructions: "Suggest helpful next actions",
    minSuggestions: 1,
    maxSuggestions: 3,
    available: "always",
    providerAgentId: "default",
    consumerAgentId: "*",
    ...overrides,
  };
}

/**
 * Helper to create a tool call message for copilotkitSuggest
 */
export function createSuggestionToolCall(
  suggestions: Array<{ title: string; message: string }>,
  overrides: Partial<Message> = {}
): Message {
  const toolCallId = `suggest-call-${Math.random().toString(36).substr(2, 9)}`;
  return createAssistantMessage({
    content: "",
    toolCalls: [
      {
        id: toolCallId,
        type: "function",
        function: {
          name: "copilotkitSuggest",
          arguments: JSON.stringify({ suggestions }),
        },
      },
    ],
    ...overrides,
  });
}

/**
 * Helper to create streaming suggestion messages with partial JSON
 * Returns an array of JSON chunks that can be assembled into complete suggestions
 */
export function createStreamingSuggestionChunks(): string[] {
  return [
    '{"suggestions":[',
    '{"title":"First","message":"Do first thing"}',
    ',{"title":"Second",',
    '"message":"Do second thing"}',
    ',{"title":"Third","message":"Do third thing"}',
    ']}',
  ];
}
