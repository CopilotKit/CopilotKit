import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { DynamicSuggestionsConfig, StaticSuggestionsConfig } from "../types";
import { MockAgent, createSuggestionsConfig, createAssistantMessage } from "./test-utils";

describe("CopilotKitCore - Suggestions Config Management", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
  });

  describe("Adding suggestions configs", () => {
    it("should add a dynamic suggestions config and return an ID", () => {
      const config = createSuggestionsConfig({
        instructions: "Test instructions",
      });

      const id = copilotKitCore.addSuggestionsConfig(config);

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
    });

    it("should notify subscribers when config is added", async () => {
      const onConfigChanged = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsConfigChanged: onConfigChanged });

      const config = createSuggestionsConfig();
      const id = copilotKitCore.addSuggestionsConfig(config);

      await vi.waitFor(() => {
        expect(onConfigChanged).toHaveBeenCalledWith({
          copilotkit: copilotKitCore,
          suggestionsConfig: expect.objectContaining({
            [id]: config,
          }),
        });
      });
    });

    it("should add multiple configs independently", () => {
      const config1 = createSuggestionsConfig({ instructions: "First" });
      const config2 = createSuggestionsConfig({ instructions: "Second" });

      const id1 = copilotKitCore.addSuggestionsConfig(config1);
      const id2 = copilotKitCore.addSuggestionsConfig(config2);

      expect(id1).not.toBe(id2);
    });
  });

  describe("Removing suggestions configs", () => {
    it("should remove a suggestions config", async () => {
      const config = createSuggestionsConfig();
      const id = copilotKitCore.addSuggestionsConfig(config);

      copilotKitCore.removeSuggestionsConfig(id);

      // Config should no longer trigger suggestions
      const agent = new MockAgent({ agentId: "test" });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
      copilotKitCore.reloadSuggestions("test");

      const result = copilotKitCore.getSuggestions("test");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });

    it("should notify subscribers when config is removed", async () => {
      const config = createSuggestionsConfig();
      const id = copilotKitCore.addSuggestionsConfig(config);

      const onConfigChanged = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsConfigChanged: onConfigChanged });

      copilotKitCore.removeSuggestionsConfig(id);

      await vi.waitFor(() => {
        expect(onConfigChanged).toHaveBeenCalledWith({
          copilotkit: copilotKitCore,
          suggestionsConfig: expect.not.objectContaining({
            [id]: expect.anything(),
          }),
        });
      });
    });
  });

  describe("Getting suggestions", () => {
    it("should return empty array when no suggestions exist", () => {
      const result = copilotKitCore.getSuggestions("nonexistent");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });

    it("should return empty array for agent without suggestions", () => {
      const agent = new MockAgent({ agentId: "test" });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

      const result = copilotKitCore.getSuggestions("test");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });
  });

  describe("Clearing suggestions", () => {
    it("should clear suggestions for an agent", () => {
      const agent = new MockAgent({ agentId: "test" });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

      copilotKitCore.clearSuggestions("test");

      const result = copilotKitCore.getSuggestions("test");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });

    it("should notify subscribers with empty suggestions array", async () => {
      const onSuggestionsChanged = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsChanged });

      copilotKitCore.clearSuggestions("test");

      await vi.waitFor(() => {
        expect(onSuggestionsChanged).toHaveBeenCalledWith({
          copilotkit: copilotKitCore,
          agentId: "test",
          suggestions: [],
        });
      });
    });

    it("should abort running suggestion agents", () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "test" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: consumerAgent as any });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Start suggestion generation
      copilotKitCore.reloadSuggestions("test");

      // Clear should abort the running agent
      copilotKitCore.clearSuggestions("test");

      // Verify abortRun was called on the cloned agent
      // Note: We can't directly verify this without exposing internal state,
      // but we can verify that subsequent getSuggestions returns empty
      const result = copilotKitCore.getSuggestions("test");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });

    it("should handle clearing suggestions when none are running", () => {
      // Should not throw
      expect(() => {
        copilotKitCore.clearSuggestions("nonexistent");
      }).not.toThrow();
    });
  });

  describe("Config type discrimination", () => {
    it("should recognize dynamic suggestions config", () => {
      const dynamicConfig: DynamicSuggestionsConfig = {
        instructions: "Test",
        minSuggestions: 1,
        maxSuggestions: 3,
      };

      const id = copilotKitCore.addSuggestionsConfig(dynamicConfig);
      expect(id).toBeDefined();
    });

    it("should recognize static suggestions config", () => {
      const staticConfig: StaticSuggestionsConfig = {
        suggestions: [
          { title: "Test 1", message: "test1", isLoading: false },
          { title: "Test 2", message: "test2", isLoading: false },
        ],
      };

      const id = copilotKitCore.addSuggestionsConfig(staticConfig);
      expect(id).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("should handle error when provider agent not found", async () => {
      const consumerAgent = new MockAgent({ agentId: "consumer" });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const config = createSuggestionsConfig({
        providerAgentId: "nonexistent",
        consumerAgentId: "consumer",
      });
      copilotKitCore.addSuggestionsConfig(config);

      // reloadSuggestions is fire-and-forget, so it doesn't throw
      // The error is caught and logged inside generateSuggestions
      expect(() => {
        copilotKitCore.reloadSuggestions("consumer");
      }).not.toThrow();

      // Give async operation time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify no suggestions were generated
      const result = copilotKitCore.getSuggestions("consumer");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });

    it("should not generate suggestions when consumer agent not found", async () => {
      const providerAgent = new MockAgent({ agentId: "provider" });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "provider", agent: providerAgent as any });

      const config = createSuggestionsConfig({
        providerAgentId: "provider",
        consumerAgentId: "nonexistent",
      });
      copilotKitCore.addSuggestionsConfig(config);

      // Since generateSuggestions is fire-and-forget (void), errors are logged but not thrown
      // The method should complete without throwing
      expect(() => {
        copilotKitCore.reloadSuggestions("nonexistent");
      }).not.toThrow();

      // Give async operation time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify no suggestions were generated
      const result = copilotKitCore.getSuggestions("nonexistent");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });
  });

  describe("Initialization with configs", () => {
    it("should accept suggestions configs in constructor", () => {
      const config1 = createSuggestionsConfig({ instructions: "First" });
      const config2 = createSuggestionsConfig({ instructions: "Second" });

      const core = new CopilotKitCore({
        suggestionsConfig: [config1, config2],
      });

      expect(core).toBeDefined();
    });
  });

  describe("Loading state", () => {
    it("should return isLoading false when no suggestions are running", () => {
      const result = copilotKitCore.getSuggestions("test");
      expect(result.isLoading).toBe(false);
    });

    it("should emit loading start event when suggestions generation begins", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const onLoadingStart = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsStartedLoading: onLoadingStart });

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

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(onLoadingStart).toHaveBeenCalledWith({
          copilotkit: copilotKitCore,
          agentId: "consumer",
        });
      });
    });

    it("should emit loading end event when all suggestions generation completes", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const onLoadingEnd = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsFinishedLoading: onLoadingEnd });

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

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(onLoadingEnd).toHaveBeenCalledWith({
          copilotkit: copilotKitCore,
          agentId: "consumer",
        });
      });
    });

    it("should only emit loading start once for multiple configs", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const onLoadingStart = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsStartedLoading: onLoadingStart });

      const config1 = createSuggestionsConfig({ instructions: "First" });
      const config2 = createSuggestionsConfig({ instructions: "Second" });
      copilotKitCore.addSuggestionsConfig(config1);
      copilotKitCore.addSuggestionsConfig(config2);

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

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls.length).toBeGreaterThanOrEqual(2);
      });

      // Should only emit once even with multiple configs
      expect(onLoadingStart).toHaveBeenCalledTimes(1);
    });

    it("should only emit loading end once after all configs complete", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const onLoadingEnd = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsFinishedLoading: onLoadingEnd });

      const config1 = createSuggestionsConfig({ instructions: "First" });
      const config2 = createSuggestionsConfig({ instructions: "Second" });
      copilotKitCore.addSuggestionsConfig(config1);
      copilotKitCore.addSuggestionsConfig(config2);

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

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(onLoadingEnd).toHaveBeenCalled();
      });

      // Should only emit once after all complete
      expect(onLoadingEnd).toHaveBeenCalledTimes(1);
    });

    it("should emit loading end even when errors occur", async () => {
      const providerAgent = new MockAgent({
        agentId: "default",
        error: new Error("Generation failed"),
      });
      const consumerAgent = new MockAgent({ agentId: "consumer" });

      copilotKitCore.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent as any });
      copilotKitCore.addAgent__unsafe_dev_only({ id: "consumer", agent: consumerAgent as any });

      const onLoadingEnd = vi.fn();
      copilotKitCore.subscribe({ onSuggestionsFinishedLoading: onLoadingEnd });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      copilotKitCore.reloadSuggestions("consumer");

      await vi.waitFor(() => {
        expect(onLoadingEnd).toHaveBeenCalledWith({
          copilotkit: copilotKitCore,
          agentId: "consumer",
        });
      });
    });
  });
});
