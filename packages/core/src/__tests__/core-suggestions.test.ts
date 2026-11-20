import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotKitCore } from "../core";
import type {
  DynamicSuggestionsConfig,
  StaticSuggestionsConfig,
} from "../types";
import {
  MockAgent,
  createSuggestionsConfig,
  createAssistantMessage,
  createMessage,
} from "./test-utils";

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
    it("should remove a suggestions config", () => {
      const id = copilotKitCore.addSuggestionsConfig({
        suggestions: [{ title: "Test", message: "test" }],
      });
      copilotKitCore.reloadSuggestions("test");
      expect(copilotKitCore.getSuggestions("test").suggestions).toHaveLength(1);

      copilotKitCore.removeSuggestionsConfig(id);

      // Config should no longer produce suggestions
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
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: agent as any,
      });

      const result = copilotKitCore.getSuggestions("test");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });
  });

  describe("Clearing suggestions", () => {
    it("should clear suggestions for an agent", () => {
      copilotKitCore.addSuggestionsConfig({
        suggestions: [{ title: "Test", message: "test" }],
      });
      copilotKitCore.reloadSuggestions("test");
      expect(copilotKitCore.getSuggestions("test").suggestions).toHaveLength(1);

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

    it("should abort running suggestion agents", async () => {
      const providerAgent = new MockAgent({ agentId: "default" });
      const consumerAgent = new MockAgent({ agentId: "test" });

      copilotKitCore.addAgent__unsafe_dev_only({
        id: "default",
        agent: providerAgent as any,
      });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: consumerAgent as any,
      });

      const config = createSuggestionsConfig();
      copilotKitCore.addSuggestionsConfig(config);

      // Start suggestion generation
      copilotKitCore.reloadSuggestions("test");
      expect(copilotKitCore.getSuggestions("test").isLoading).toBe(true);
      const suggestionAgent = providerAgent.clone.mock.results[0]!.value;

      // Clear should abort the running agent
      copilotKitCore.clearSuggestions("test");

      expect(suggestionAgent.abortRun).toHaveBeenCalled();
      const result = copilotKitCore.getSuggestions("test");
      expect(result.suggestions).toEqual([]);
      expect(result.isLoading).toBe(false);

      // The aborted run never sends its request
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(providerAgent.runAgentCalls).toHaveLength(0);
    });

    it("should handle clearing suggestions when none are running", () => {
      // Should not throw
      expect(() => {
        copilotKitCore.clearSuggestions("nonexistent");
      }).not.toThrow();
    });
  });

  describe("Config type discrimination", () => {
    it("should recognize dynamic suggestions config", async () => {
      const dynamicConfig: DynamicSuggestionsConfig = {
        instructions: "Test",
        minSuggestions: 1,
        maxSuggestions: 3,
      };
      const providerAgent = new MockAgent({ agentId: "default" });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "default",
        agent: providerAgent as any,
      });
      // Dynamic configs default to after-first-message
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "consumer",
        agent: new MockAgent({
          agentId: "consumer",
          messages: [createMessage()],
        }) as any,
      });

      copilotKitCore.addSuggestionsConfig(dynamicConfig);
      copilotKitCore.reloadSuggestions("consumer");

      // Dynamic: runs the provider agent instead of returning items directly
      expect(copilotKitCore.getSuggestions("consumer")).toEqual({
        suggestions: [],
        isLoading: true,
      });
      await vi.waitFor(() => {
        expect(providerAgent.runAgentCalls).toHaveLength(1);
      });
    });

    it("should recognize static suggestions config", () => {
      const staticConfig: StaticSuggestionsConfig = {
        suggestions: [
          { title: "Test 1", message: "test1" },
          { title: "Test 2", message: "test2" },
        ],
      };

      copilotKitCore.addSuggestionsConfig(staticConfig);
      copilotKitCore.reloadSuggestions("consumer");

      // Static: items are returned directly, with no generation run
      expect(copilotKitCore.getSuggestions("consumer")).toEqual({
        suggestions: [
          { title: "Test 1", message: "test1", isLoading: false },
          { title: "Test 2", message: "test2", isLoading: false },
        ],
        isLoading: false,
      });
    });
  });

  describe("Error handling", () => {
    it("should log and settle loading when provider agent not found", async () => {
      const consumerAgent = new MockAgent({ agentId: "consumer" });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "consumer",
        agent: consumerAgent as any,
      });

      const config = createSuggestionsConfig({
        providerAgentId: "nonexistent",
        consumerAgentId: "consumer",
      });
      copilotKitCore.addSuggestionsConfig(config);

      const onLoadingStart = vi.fn();
      const onLoadingEnd = vi.fn();
      copilotKitCore.subscribe({
        onSuggestionsStartedLoading: onLoadingStart,
        onSuggestionsFinishedLoading: onLoadingEnd,
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        // reloadSuggestions is fire-and-forget: the failure is logged, not thrown
        copilotKitCore.reloadSuggestions("consumer");

        expect(warnSpy).toHaveBeenCalledWith(
          "Error generating suggestions:",
          expect.objectContaining({
            message: expect.stringContaining("provider agent not found"),
          }),
        );

        // Let the subscriber notifications (microtasks) settle.
        await new Promise((resolve) => setTimeout(resolve, 0));

        // A subscriber that saw "started" must also see "finished"
        expect(onLoadingEnd).toHaveBeenCalledTimes(
          onLoadingStart.mock.calls.length,
        );
        for (const [event] of onLoadingEnd.mock.calls) {
          expect(event).toMatchObject({ agentId: "consumer" });
        }

        const result = copilotKitCore.getSuggestions("consumer");
        expect(result.suggestions).toEqual([]);
        expect(result.isLoading).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should skip dynamic generation when consumer agent not found", async () => {
      const providerAgent = new MockAgent({ agentId: "provider" });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "provider",
        agent: providerAgent as any,
      });

      const config = createSuggestionsConfig({
        providerAgentId: "provider",
        consumerAgentId: "nonexistent",
      });
      copilotKitCore.addSuggestionsConfig(config);

      const onLoadingStart = vi.fn();
      copilotKitCore.subscribe({
        onSuggestionsStartedLoading: onLoadingStart,
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        copilotKitCore.reloadSuggestions("nonexistent");
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Generation is skipped up front, not attempted and failed: an attempt
        // would announce loading and then log "consumer agent not found".
        expect(onLoadingStart).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalledWith(
          "Error generating suggestions:",
          expect.anything(),
        );

        const result = copilotKitCore.getSuggestions("nonexistent");
        expect(result.suggestions).toEqual([]);
        expect(result.isLoading).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("Initialization with configs", () => {
    it("should use suggestions configs passed to the constructor", async () => {
      const staticConfig: StaticSuggestionsConfig = {
        suggestions: [
          { title: "Test 1", message: "test1" },
          { title: "Test 2", message: "test2" },
        ],
      };
      const dynamicConfig = createSuggestionsConfig({
        consumerAgentId: "consumer",
      });

      const core = new CopilotKitCore({
        suggestionsConfig: [staticConfig, dynamicConfig],
      });
      const providerAgent = new MockAgent({ agentId: "default" });
      core.addAgent__unsafe_dev_only({
        id: "default",
        agent: providerAgent as any,
      });
      core.addAgent__unsafe_dev_only({
        id: "consumer",
        agent: new MockAgent({ agentId: "consumer" }) as any,
      });

      core.reloadSuggestions("consumer");

      // Static config is applied immediately; dynamic config starts a run
      const result = core.getSuggestions("consumer");
      expect(result.suggestions).toEqual([
        { title: "Test 1", message: "test1", isLoading: false },
        { title: "Test 2", message: "test2", isLoading: false },
      ]);
      expect(result.isLoading).toBe(true);

      await vi.waitFor(() => {
        expect(core.getSuggestions("consumer").isLoading).toBe(false);
      });
      expect(providerAgent.runAgentCalls).toHaveLength(1);
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

      copilotKitCore.addAgent__unsafe_dev_only({
        id: "default",
        agent: providerAgent as any,
      });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "consumer",
        agent: consumerAgent as any,
      });

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
                arguments: [
                  '{"suggestions":[{"title":"Test","message":"Test"}]}',
                ] as any,
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

      copilotKitCore.addAgent__unsafe_dev_only({
        id: "default",
        agent: providerAgent as any,
      });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "consumer",
        agent: consumerAgent as any,
      });

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
                arguments: [
                  '{"suggestions":[{"title":"Test","message":"Test"}]}',
                ] as any,
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

      copilotKitCore.addAgent__unsafe_dev_only({
        id: "default",
        agent: providerAgent as any,
      });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "consumer",
        agent: consumerAgent as any,
      });

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
                arguments: [
                  '{"suggestions":[{"title":"Test","message":"Test"}]}',
                ] as any,
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

      copilotKitCore.addAgent__unsafe_dev_only({
        id: "default",
        agent: providerAgent as any,
      });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "consumer",
        agent: consumerAgent as any,
      });

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
                arguments: [
                  '{"suggestions":[{"title":"Test","message":"Test"}]}',
                ] as any,
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

      copilotKitCore.addAgent__unsafe_dev_only({
        id: "default",
        agent: providerAgent as any,
      });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "consumer",
        agent: consumerAgent as any,
      });

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
