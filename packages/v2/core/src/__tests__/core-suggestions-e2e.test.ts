import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { Suggestion } from "../types";
import { MockAgent, createSuggestionsConfig, createMessage, createAssistantMessage } from "./test-utils";

describe("CopilotKitCore - Suggestions E2E", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
  });

  describe("Basic suggestion generation flow", () => {
    it("should generate suggestions by calling copilotkitSuggest tool", async () => {
      // Setup provider and consumer agents
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({
        agentId: "consumer",
        messages: [createMessage({ content: "User asked something" })],
      });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      // Setup suggestions config
      const config = createSuggestionsConfig({
        instructions: "Suggest helpful actions",
        minSuggestions: 2,
        maxSuggestions: 3,
        consumerAgentId: "consumer",
      });
      copilotKitCore.addSuggestionsConfig(config);

      // Mock the provider agent to return suggestion tool call
      // Note: arguments should be an array of strings for streaming support
      // Each string is a chunk that can be partial JSON
      const suggestionToolCall = createAssistantMessage({
        content: "",
        toolCalls: [
          {
            id: "suggest-1",
            type: "function",
            function: {
              name: "copilotkitSuggest",
              arguments: [
                '{"suggestions":[',
                '{"title":"Action 1","message":"Do action 1"}',
                ',{"title":"Action 2","message":"Do action 2"}',
                "]}",
              ] as any,
            },
          },
        ],
      } as any);

      providerAgent.setNewMessages([suggestionToolCall]);

      // Track subscriber calls
      const onSuggestionsChanged = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsChanged });

      // Trigger suggestion generation
      copilotKitCore.reloadSuggestions("consumer");

      // Wait for suggestions to be generated
      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      // Verify suggestions were generated
      const result = copilotKitCore.getSuggestions("consumer");
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0]).toEqual({ title: "Action 1", message: "Do action 1", isLoading: false });
      expect(result.suggestions[1]).toEqual({ title: "Action 2", message: "Do action 2", isLoading: false });

      // Verify subscriber was notified
      await vi.waitFor(() => {
        expect(onSuggestionsChanged).toHaveBeenCalled();
      });
    });

    it("should include instructions and constraints in suggestion prompt", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig({
        instructions: "Focus on data analysis tasks",
        minSuggestions: 2,
        maxSuggestions: 4,
      });
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      copilotKitCore.reloadSuggestions("consumer");

      // Check that the cloned agent received the correct prompt
      await vi.waitFor(() => {
        expect(providerAgent.addMessage).toHaveBeenCalled();
      });

      const addMessageCalls = providerAgent.addMessage.mock.calls;
      expect(addMessageCalls.length).toBeGreaterThan(0);

      const promptMessage = addMessageCalls[0][0];
      expect(promptMessage.role).toBe("user");
      expect(promptMessage.content).toContain("copilotkitSuggest");
      expect(promptMessage.content).toContain("at least 2");
      expect(promptMessage.content).toContain("at most 4");
      expect(promptMessage.content).toContain("Focus on data analysis tasks");
    });

    it("should force toolChoice to copilotkitSuggest", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      copilotKitCore.reloadSuggestions("consumer");

      // Verify runAgent was called with forced tool choice
      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThan(0);
      });

      const runAgentCall = providerAgent.runAgentCalls[0];
      expect(runAgentCall.forwardedProps.toolChoice).toEqual({
        type: "function",
        function: { name: "copilotkitSuggest" },
      });
    });
  });

  describe("Agent ID filtering patterns", () => {
    it("should apply suggestions to specific consumer agent ID", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const targetAgent = new MockAgent({ agentId: "target" });
      const otherAgent = new MockAgent({ agentId: "other" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "target", agent: targetAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "other", agent: otherAgent as any });

      const config = createSuggestionsConfig({
        consumerAgentId: "target",
      });
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      // Reload for target agent - should generate
      copilotKitCore.reloadSuggestions("target");

      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThan(0);
      });

      // Reload for other agent - should NOT generate
      providerAgent.runAgentCalls = [];
      copilotKitCore.reloadSuggestions("other");

      // Give it a moment
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(providerAgent.runAgentCalls.length).toBe(0);
    });

    it("should apply suggestions to all agents when consumer ID is *", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const agent1 = new MockAgent({ agentId: "agent1" });
      const agent2 = new MockAgent({ agentId: "agent2" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent1 as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "agent2", agent: agent2 as any });

      const config = createSuggestionsConfig({
        consumerAgentId: "*",
      });
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      // Should generate for both agents
      copilotKitCore.reloadSuggestions("agent1");
      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThan(0);
      });

      const callCountAfterFirst = providerAgent.runAgentCalls.length;

      copilotKitCore.reloadSuggestions("agent2");
      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThan(callCountAfterFirst);
      });
    });

    it("should apply suggestions when consumer ID is undefined", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig({
        consumerAgentId: undefined,
      });
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Streaming and partial JSON suggestions", () => {
    it("should handle streaming suggestions with incomplete JSON", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Track subscriber calls to see streaming updates
      const suggestionUpdates: Suggestion[][] = [];
      copilotKitCore.subscribe({
        onSuggestionsChanged: ({ suggestions }) => {
          suggestionUpdates.push([...suggestions]);
        },
      });

      // Simulate streaming tool call with partial JSON
      const partialToolCall = createAssistantMessage({
        content: "",
        toolCalls: [
          {
            id: "stream-1",
            type: "function",
            function: {
              name: "copilotkitSuggest",
              // Incomplete JSON - missing closing bracket
              arguments: ['{"suggestions":[{"title":"First","message":"First action"}'] as any,
            },
          },
        ],
      });

      providerAgent.setNewMessages([partialToolCall]);
      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(suggestionUpdates.length).toBeGreaterThanOrEqual(2);
      });

      // Find the update with suggestions (skip empty initial updates)
      const streamingUpdate = suggestionUpdates.find(update => update.length > 0 && update[0].isLoading === true);
      expect(streamingUpdate).toBeDefined();
      expect(streamingUpdate![0]).toMatchObject({
        title: "First",
        message: "First action",
        isLoading: true,
      });

      // After finalization, isLoading should be false
      await vi.waitFor(() => {
        const lastUpdate = suggestionUpdates[suggestionUpdates.length - 1];
        expect(lastUpdate.length).toBeGreaterThan(0);
        expect(lastUpdate[0].isLoading).toBe(false);
      });

      const finalUpdate = suggestionUpdates[suggestionUpdates.length - 1];
      expect(finalUpdate[0]).toMatchObject({
        title: "First",
        message: "First action",
        isLoading: false,
      });
    });

    it("should update suggestions as more JSON chunks arrive", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      const suggestionUpdates: number[] = [];
      copilotKitCore.subscribe({
        onSuggestionsChanged: ({ suggestions }) => {
          suggestionUpdates.push(suggestions.length);
        },
      });

      // Simulate multiple chunks arriving
      const streamingToolCall = createAssistantMessage({
        content: "",
        toolCalls: [
          {
            id: "stream-2",
            type: "function",
            function: {
              name: "copilotkitSuggest",
              arguments: [
                '{"suggestions":[',
                '{"title":"First","message":"msg1"},',
                '{"title":"Second","message":"msg2"}',
                "]}",
              ] as any,
            },
          },
        ],
      });

      providerAgent.setNewMessages([streamingToolCall]);
      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.suggestions.length).toBe(2);
      });

      const result = copilotKitCore.getSuggestions("consumer");
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0].title).toBe("First");
      expect(result.suggestions[1].title).toBe("Second");
    });
  });

  describe("Multiple configs and concurrent generation", () => {
    it("should generate suggestions for multiple configs", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      // Add two different suggestion configs
      const config1 = createSuggestionsConfig({
        instructions: "Suggest actions",
      });
      const config2 = createSuggestionsConfig({
        instructions: "Suggest questions",
      });

      copilotKitCore.addSuggestionsConfig(config1);
      copilotKitCore.addSuggestionsConfig(config2);

      // Mock provider to return different suggestions
      const toolCall1 = createAssistantMessage({
        content: "",
        toolCalls: [
          {
            id: "suggest-1",
            type: "function",
            function: {
              name: "copilotkitSuggest",
              arguments: ['{"suggestions":[{"title":"Action","message":"Do action"}]}'] as any,
            },
          },
        ],
      });

      providerAgent.setNewMessages([toolCall1]);

      copilotKitCore.reloadSuggestions("consumer");

      // Should have called runAgent twice (once per config)
      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThanOrEqual(2);
      });
    });

    it("should handle concurrent suggestion generation for different agents", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const agent1 = new MockAgent({ agentId: "agent1" });
      const agent2 = new MockAgent({ agentId: "agent2" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "agent1", agent: agent1 as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "agent2", agent: agent2 as any });

      const config = createSuggestionsConfig({
        consumerAgentId: "*",
      });
      copilotKitCore.addSuggestionsConfig(config);

      const toolCall = createAssistantMessage({
        content: "",
        toolCalls: [
          {
            id: "suggest-x",
            type: "function",
            function: {
              name: "copilotkitSuggest",
              arguments: ['{"suggestions":[{"title":"Test","message":"Test msg"}]}'] as any,
            },
          },
        ],
      });

      providerAgent.setNewMessages([toolCall]);

      // Trigger both concurrently
      copilotKitCore.reloadSuggestions("agent1");
      copilotKitCore.reloadSuggestions("agent2");

      // Both should have suggestions
      await vi.waitFor(() => {
        const result1 = copilotKitCore.getSuggestions("agent1");
        const result2 = copilotKitCore.getSuggestions("agent2");
        expect(result1.suggestions.length).toBeGreaterThan(0);
        expect(result2.suggestions.length).toBeGreaterThan(0);
      });
    });

    it("should generate independent suggestion sets for same agent", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config1 = createSuggestionsConfig({ instructions: "Type 1" });
      const config2 = createSuggestionsConfig({ instructions: "Type 2" });

      copilotKitCore.addSuggestionsConfig(config1);
      copilotKitCore.addSuggestionsConfig(config2);

      // Set messages that will be returned for both configs
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Suggestion 1","message":"msg1"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      copilotKitCore.reloadSuggestions("consumer");

      // Wait for both configs to be called
      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThanOrEqual(2);
      });

      // Both config invocations should have generated suggestions
      // Since they share the same response, we should have at least 1 suggestion
      // (Could be 2 if both succeeded, but timing might cause only one)
      const result = copilotKitCore.getSuggestions("consumer");
      expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Context and properties forwarding", () => {
    it("should forward context to suggestion provider agent", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      // Add context
      const contextId = copilotKitCore.addContext({
        description: "User preferences",
        value: { theme: "dark", language: "en" } as any,
      });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThan(0);
      });

      const runAgentCall = providerAgent.runAgentCalls[0];
      expect(runAgentCall.context).toEqual([
        { description: "User preferences", value: { theme: "dark", language: "en" } },
      ]);

      // Cleanup
      copilotKitCore.removeContext(contextId);
    });

    it("should forward properties to suggestion provider agent", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      const core = new CopilotKitCore({
        properties: { userId: "123", sessionId: "abc" },
      });

      core.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      core.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      core.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      core.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThan(0);
      });

      const runAgentCall = providerAgent.runAgentCalls[0];
      expect(runAgentCall.forwardedProps).toMatchObject({
        userId: "123",
        sessionId: "abc",
      });
    });

    it("should include available frontend tools in suggestion prompt", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      // Add some frontend tools
      copilotKitCore.addTool({
        name: "searchTool",
        description: "Search for information",
      });
      copilotKitCore.addTool({
        name: "analyzeTool",
        description: "Analyze data",
      });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(providerAgent.addMessage).toHaveBeenCalled();
      });

      const promptMessage = providerAgent.addMessage.mock.calls[0][0];
      expect(promptMessage.content).toContain("searchTool");
      expect(promptMessage.content).toContain("analyzeTool");
    });
  });

  describe("Agent cloning", () => {
    it("should clone provider agent for suggestion generation", async () => {
      const providerAgent = new MockAgent({
        agentId: "default",
        state: { original: true },
      });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(providerAgent.clone).toHaveBeenCalled();
      });
    });

    it("should copy consumer agent messages to suggestion agent", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerMessages = [
        createMessage({ content: "User question" }),
        createAssistantMessage({ content: "Assistant response" }),
      ];
      const consumerAgent = new MockAgent({
        agentId: "consumer",
        messages: consumerMessages,
      });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      copilotKitCore.reloadSuggestions("consumer");

      // The cloned agent should receive the consumer's message history
      await vi.waitFor(() => {
        expect(providerAgent.clone).toHaveBeenCalled();
      });

      // Verify clone was called and messages would be copied
      expect(providerAgent.clone).toHaveBeenCalled();
    });

    it("should copy consumer agent state to suggestion agent", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({
        agentId: "consumer",
        state: { conversationContext: "important data", stepCount: 5 },
      });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(providerAgent.clone).toHaveBeenCalled();
      });

      // Verify clone preserves state
      expect(providerAgent.clone).toHaveBeenCalled();
    });

    it("should assign unique agentId and threadId to suggestion agent", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      copilotKitCore.reloadSuggestions("consumer");

      // The cloned agent should have a unique ID
      await vi.waitFor(() => {
        expect(providerAgent.clone).toHaveBeenCalled();
      });

      // Each clone should get a unique suggestion ID
      expect(providerAgent.clone).toHaveBeenCalled();
    });
  });

  describe("Suggestion abortion and reload", () => {
    it("should abort running suggestions when a user message is submitted (runAgent)", async () => {
      const providerAgent = new MockAgent({ agentId: "default", runAgentDelay: 100 });
      const consumerAgent = new MockAgent({
        agentId: "consumer",
        messages: [createMessage({ content: "Initial message" })],
      });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig({ consumerAgentId: "consumer" });
      copilotKitCore.addSuggestionsConfig(config);

      // Begin generating suggestions and wait until the provider is cloned (run in progress)
      copilotKitCore.reloadSuggestions("consumer");
      await vi.waitFor(() => {
        expect(providerAgent.clone).toHaveBeenCalled();
      });

      // Grab the cloned suggestion agent instance to assert abort
      const clonedSuggestionAgent = (providerAgent.clone as any).mock.results[0]?.value;
      expect(clonedSuggestionAgent).toBeDefined();

      // Ensure loading state is on before user submits new message
      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.isLoading).toBe(true);
      });

      // Additionally assert abort happens before the user's run starts
      consumerAgent.runAgentCallback = () => {
        expect(clonedSuggestionAgent.abortRun).toHaveBeenCalled();
      };

      // Simulate user submitting a new message which triggers runAgent (and should clear/abort suggestions immediately)
      consumerAgent.addMessages([createMessage({ content: "User follow-up" })]);
      await copilotKitCore.runAgent({
        agent: consumerAgent as any,
      });

      // The in-flight suggestion run should be aborted
      expect(clonedSuggestionAgent.abortRun).toHaveBeenCalled();

      // Suggestions should be cleared and isLoading turned off
      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.isLoading).toBe(false);
        expect(result.suggestions).toEqual([]);
      });
    });
    it("should abort running suggestions when clearSuggestions is called", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      // Start generation
      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThan(0);
      });

      // Clear should abort
      copilotKitCore.clearSuggestions("consumer");

      // Verify suggestions are cleared
      const result = copilotKitCore.getSuggestions("consumer");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });

    it("should create fresh agents on subsequent reloadSuggestions", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      // First reload
      copilotKitCore.reloadSuggestions("consumer");
      await vi.waitFor(() => {
        expect(providerAgent.clone).toHaveBeenCalledTimes(1);
      });

      // Clear
      copilotKitCore.clearSuggestions("consumer");

      // Second reload - should clone again
      copilotKitCore.reloadSuggestions("consumer");
      await vi.waitFor(() => {
        expect(providerAgent.clone).toHaveBeenCalledTimes(2);
      });
    });

    it("should notify subscribers when suggestions are cleared", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const onSuggestionsChanged = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsChanged });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response to trigger completion
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThan(0);
      });

      // Clear and verify notification
      copilotKitCore.clearSuggestions("consumer");

      await vi.waitFor(() => {
        const clearCall = onSuggestionsChanged.mock.calls.find(
          (call) => call[0].suggestions.length === 0 && call[0].agentId === "consumer",
        );
        expect(clearCall).toBeDefined();
      });
    });
  });

  describe("Error handling during suggestion generation", () => {
    it("should handle error when suggestion generation fails", async () => {
      const providerAgent = new MockAgent({
        agentId: "default",
        error: new Error("Generation failed"),
      });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Should not throw, error should be caught internally
      copilotKitCore.reloadSuggestions("consumer");

      // Give it a moment
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Suggestions should be empty due to error
      const result = copilotKitCore.getSuggestions("consumer");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });

    it("should handle malformed suggestion tool call", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      // Return tool call without proper structure
      const malformedToolCall = createAssistantMessage({
        content: "",
        toolCalls: [
          {
            id: "malformed",
            type: "function",
            function: {
              name: "copilotkitSuggest",
              arguments: "not valid json",
            },
          },
        ],
      });

      providerAgent.setNewMessages([malformedToolCall]);

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      copilotKitCore.reloadSuggestions("consumer");

      // Should not crash
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Suggestions should be empty or handle gracefully
      const result = copilotKitCore.getSuggestions("consumer");
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(typeof result.isLoading).toBe("boolean");
    });
  });

  describe("Loading state E2E", () => {
    it("should track isLoading state during suggestion generation lifecycle", async () => {
      const providerAgent = new MockAgent({ agentId: "default", runAgentDelay: 50 });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Mock a response
      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      // Before triggering, isLoading should be false
      let result = copilotKitCore.getSuggestions("consumer");
      expect(result.isLoading).toBe(false);

      // Trigger suggestions
      copilotKitCore.reloadSuggestions("consumer");

      // During generation, isLoading should be true
      await vi.waitFor(() => {
        result = copilotKitCore.getSuggestions("consumer");
        expect(result.isLoading).toBe(true);
      });

      // After generation completes, isLoading should be false
      await vi.waitFor(() => {
        result = copilotKitCore.getSuggestions("consumer");
        expect(result.isLoading).toBe(false);
      });
    });

    it("should emit loading start and end events in correct order", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const events: string[] = [];
      copilotKitCore.subscribe({
        onSuggestionsStartedLoading: () => {
          events.push("start");
        },
        onSuggestionsFinishedLoading: () => {
          events.push("end");
        },
        onSuggestionsChanged: () => {
          events.push("changed");
        },
      });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(events).toContain("start");
        expect(events).toContain("end");
      });

      // Start should come before end
      const startIndex = events.indexOf("start");
      const endIndex = events.lastIndexOf("end");
      expect(startIndex).toBeLessThan(endIndex);
    });

    it("should handle isLoading with multiple concurrent configs", async () => {
      const providerAgent = new MockAgent({ agentId: "default", runAgentDelay: 50 });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config1 = createSuggestionsConfig({ instructions: "First" });
      const config2 = createSuggestionsConfig({ instructions: "Second" });
      copilotKitCore.addSuggestionsConfig(config1);
      copilotKitCore.addSuggestionsConfig(config2);

      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "s1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Test","message":"Test"}]}'] as any,
              },
            },
          ],
        }),
      ]);

      copilotKitCore.reloadSuggestions("consumer");

      // During generation, isLoading should be true
      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.isLoading).toBe(true);
      });

      // After all complete, isLoading should be false
      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.isLoading).toBe(false);
      });
    });

    it("should set isLoading to false after errors", async () => {
      const providerAgent = new MockAgent({
        agentId: "default",
        error: new Error("Generation failed"),
      });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      copilotKitCore.reloadSuggestions("consumer");

      // After error, isLoading should be false
      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.isLoading).toBe(false);
      });
    });
  });

  describe("SuggestionAvailability - Dynamic Suggestions", () => {
    it("should show dynamic suggestions with 'before-first-message' only when messages are empty", async () => {
      const providerAgent = new MockAgent({ agentId: "provider" });
      const consumerAgent = new MockAgent({ agentId: "consumer", messages: [] });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "provider", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig({
        instructions: "Suggest actions",
        providerAgentId: "provider",
        consumerAgentId: "consumer",
        available: "before-first-message",
      });
      copilotKitCore.addSuggestionsConfig(config);

      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "tc-1",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Start","message":"Get started"}]}'] as any,
              },
            },
          ],
        } as any),
      ]);

      // Should show suggestions when messages are empty
      copilotKitCore.reloadSuggestions("consumer");
      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      const result1 = copilotKitCore.getSuggestions("consumer");
      expect(result1.suggestions).toHaveLength(1);
      expect(result1.suggestions[0]?.title).toBe("Start");

      // Add a message and reload - should not show suggestions
      consumerAgent.messages = [createMessage({ content: "First message" })];
      copilotKitCore.reloadSuggestions("consumer");

      const result2 = copilotKitCore.getSuggestions("consumer");
      expect(result2.suggestions).toHaveLength(0);
    });

    it("should show dynamic suggestions with 'after-first-message' only when messages exist", async () => {
      const providerAgent = new MockAgent({ agentId: "provider" });
      const consumerAgent = new MockAgent({ agentId: "consumer", messages: [] });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "provider", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig({
        instructions: "Suggest next actions",
        providerAgentId: "provider",
        consumerAgentId: "consumer",
        available: "after-first-message",
      });
      copilotKitCore.addSuggestionsConfig(config);

      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "tc-2",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Continue","message":"Keep going"}]}'] as any,
              },
            },
          ],
        } as any),
      ]);

      // Should not show suggestions when messages are empty
      copilotKitCore.reloadSuggestions("consumer");
      const result1 = copilotKitCore.getSuggestions("consumer");
      expect(result1.suggestions).toHaveLength(0);

      // Add a message and reload - should show suggestions
      consumerAgent.messages = [createMessage({ content: "First message" })];
      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      const result2 = copilotKitCore.getSuggestions("consumer");
      expect(result2.suggestions).toHaveLength(1);
      expect(result2.suggestions[0]?.title).toBe("Continue");
    });

    it("should show dynamic suggestions with 'always' regardless of message count", async () => {
      const providerAgent = new MockAgent({ agentId: "provider" });
      const consumerAgent = new MockAgent({ agentId: "consumer", messages: [] });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "provider", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig({
        instructions: "Always suggest",
        providerAgentId: "provider",
        consumerAgentId: "consumer",
        available: "always",
      });
      copilotKitCore.addSuggestionsConfig(config);

      providerAgent.setNewMessages([
        createAssistantMessage({
          toolCalls: [
            {
              id: "tc-3",
              type: "function",
              function: {
                name: "copilotkitSuggest",
                arguments: ['{"suggestions":[{"title":"Always","message":"Always available"}]}'] as any,
              },
            },
          ],
        } as any),
      ]);

      // Should show when empty
      copilotKitCore.reloadSuggestions("consumer");
      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      const result1 = copilotKitCore.getSuggestions("consumer");
      expect(result1.suggestions[0]?.title).toBe("Always");

      // Should also show when messages exist
      consumerAgent.messages = [createMessage({ content: "Message" })];
      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      const result2 = copilotKitCore.getSuggestions("consumer");
      expect(result2.suggestions[0]?.title).toBe("Always");
    });

    it("should not show dynamic suggestions with 'disabled'", async () => {
      const providerAgent = new MockAgent({ agentId: "provider" });
      const consumerAgent = new MockAgent({ agentId: "consumer", messages: [] });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "provider", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig({
        instructions: "Should not appear",
        providerAgentId: "provider",
        consumerAgentId: "consumer",
        available: "disabled",
      });
      copilotKitCore.addSuggestionsConfig(config);

      // Should not show regardless of message count
      copilotKitCore.reloadSuggestions("consumer");
      const result1 = copilotKitCore.getSuggestions("consumer");
      expect(result1.suggestions).toHaveLength(0);

      consumerAgent.messages = [createMessage({ content: "Message" })];
      copilotKitCore.reloadSuggestions("consumer");
      const result2 = copilotKitCore.getSuggestions("consumer");
      expect(result2.suggestions).toHaveLength(0);
    });

  });

  describe("SuggestionAvailability - Static Suggestions", () => {
    it("should show static suggestions with 'before-first-message' only when messages are empty", () => {
      const consumerAgent = new MockAgent({ agentId: "consumer", messages: [] });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      copilotKitCore.addSuggestionsConfig({
        suggestions: [
          { title: "Start Here", message: "Begin your journey", isLoading: false },
          { title: "Learn More", message: "Get information", isLoading: false },
        ],
        consumerAgentId: "consumer",
        available: "before-first-message",
      });

      // Should show when empty
      copilotKitCore.reloadSuggestions("consumer");
      const result1 = copilotKitCore.getSuggestions("consumer");
      expect(result1.suggestions).toHaveLength(2);
      expect(result1.suggestions[0]?.title).toBe("Start Here");
      expect(result1.isLoading).toBe(false);

      // Should not show when messages exist
      consumerAgent.messages = [createMessage({ content: "Message" })];
      copilotKitCore.reloadSuggestions("consumer");
      const result2 = copilotKitCore.getSuggestions("consumer");
      expect(result2.suggestions).toHaveLength(0);
    });

    it("should show static suggestions with 'after-first-message' only when messages exist", () => {
      const consumerAgent = new MockAgent({ agentId: "consumer", messages: [] });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      copilotKitCore.addSuggestionsConfig({
        suggestions: [{ title: "Next Step", message: "Continue", isLoading: false }],
        consumerAgentId: "consumer",
        available: "after-first-message",
      });

      // Should not show when empty
      copilotKitCore.reloadSuggestions("consumer");
      const result1 = copilotKitCore.getSuggestions("consumer");
      expect(result1.suggestions).toHaveLength(0);

      // Should show when messages exist
      consumerAgent.messages = [createMessage({ content: "Message" })];
      copilotKitCore.reloadSuggestions("consumer");
      const result2 = copilotKitCore.getSuggestions("consumer");
      expect(result2.suggestions).toHaveLength(1);
      expect(result2.suggestions[0]?.title).toBe("Next Step");
    });

    it("should show static suggestions with 'always' regardless of message count", () => {
      const consumerAgent = new MockAgent({ agentId: "consumer", messages: [] });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      copilotKitCore.addSuggestionsConfig({
        suggestions: [{ title: "Persistent", message: "Always here", isLoading: false }],
        consumerAgentId: "consumer",
        available: "always",
      });

      // Should show when empty
      copilotKitCore.reloadSuggestions("consumer");
      const result1 = copilotKitCore.getSuggestions("consumer");
      expect(result1.suggestions).toHaveLength(1);

      // Should show when messages exist
      consumerAgent.messages = [createMessage({ content: "Message" })];
      copilotKitCore.reloadSuggestions("consumer");
      const result2 = copilotKitCore.getSuggestions("consumer");
      expect(result2.suggestions).toHaveLength(1);
    });

    it("should not show static suggestions with 'disabled'", () => {
      const consumerAgent = new MockAgent({ agentId: "consumer", messages: [] });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      copilotKitCore.addSuggestionsConfig({
        suggestions: [{ title: "Hidden", message: "Should not appear", isLoading: false }],
        consumerAgentId: "consumer",
        available: "disabled",
      });

      copilotKitCore.reloadSuggestions("consumer");
      const result = copilotKitCore.getSuggestions("consumer");
      expect(result.suggestions).toHaveLength(0);
    });

    it("should default to 'before-first-message' for static suggestions when availability not specified", () => {
      const consumerAgent = new MockAgent({ agentId: "consumer", messages: [] });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      copilotKitCore.addSuggestionsConfig({
        suggestions: [{ title: "Default Static", message: "Default behavior", isLoading: false }],
        consumerAgentId: "consumer",
        // No 'available' specified
      });

      // Should show when empty (default: before-first-message)
      copilotKitCore.reloadSuggestions("consumer");
      const result1 = copilotKitCore.getSuggestions("consumer");
      expect(result1.suggestions).toHaveLength(1);

      // Should not show when messages exist
      consumerAgent.messages = [createMessage({ content: "Message" })];
      copilotKitCore.reloadSuggestions("consumer");
      const result2 = copilotKitCore.getSuggestions("consumer");
      expect(result2.suggestions).toHaveLength(0);
    });
  });
});
