import React, { useCallback, useEffect } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithCopilotKit } from "@/__tests__/utils/test-helpers";
import { useSuggestions } from "../use-suggestions";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkitnext/shared";
import { AbstractAgent, AgentSubscriber, Message, RunAgentParameters, RunAgentResult } from "@ag-ui/client";
import { Suggestion } from "@copilotkitnext/core";

class SuggestionsProviderAgent extends AbstractAgent {
  constructor(private readonly responses: Suggestion[]) {
    super({ agentId: DEFAULT_AGENT_ID });
  }

  run(): never {
    throw new Error("SuggestionsProviderAgent should not use stream run");
  }

  override clone(): SuggestionsProviderAgent {
    const cloned = new SuggestionsProviderAgent(this.responses);
    cloned.threadId = this.threadId;
    cloned.description = this.description;
    cloned.messages = JSON.parse(JSON.stringify(this.messages));
    cloned.state = JSON.parse(JSON.stringify(this.state));
    return cloned;
  }

  override async runAgent(
    parameters: RunAgentParameters = {},
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const input = this.prepareRunAgentInput(parameters);
    this.isRunning = true;

    if (subscriber?.onRunInitialized) {
      await subscriber.onRunInitialized({
        agent: this,
        messages: this.messages,
        state: this.state,
        input,
      });
    }

    // Create the suggestion response message
    const suggestionMessage: Message = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: randomUUID(),
          type: "function",
          function: {
            name: "copilotkitSuggest",
            arguments: JSON.stringify({ suggestions: this.responses }),
          },
        },
      ],
    } as Message;

    this.addMessage(suggestionMessage);

    // Notify subscriber with the updated messages (including the new suggestion)
    if (subscriber?.onMessagesChanged) {
      await subscriber.onMessagesChanged({
        agent: this,
        messages: this.messages,
        state: this.state,
        input,
      });
    }

    if (subscriber?.onRunFinalized) {
      await subscriber.onRunFinalized({
        agent: this,
        messages: this.messages,
        state: this.state,
        input,
      });
    }

    this.isRunning = false;

    return {
      newMessages: [suggestionMessage],
      result: undefined,
    };
  }
}

const TestHarness: React.FC = () => {
  const { suggestions, isLoading, reloadSuggestions, clearSuggestions } = useSuggestions();
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    const configId = copilotkit.addSuggestionsConfig({
      instructions: "Return deterministic suggestions",
      providerAgentId: DEFAULT_AGENT_ID,
      consumerAgentId: DEFAULT_AGENT_ID,
      available: "always",
    });

    return () => {
      copilotkit.removeSuggestionsConfig(configId);
    };
  }, [copilotkit]);

  const handleReload = useCallback(() => {
    reloadSuggestions();
  }, [reloadSuggestions]);

  const handleClear = useCallback(() => {
    clearSuggestions();
  }, [clearSuggestions]);

  return (
    <div>
      <div data-testid="suggestions-count">{suggestions.length}</div>
      <div data-testid="suggestions-json">{JSON.stringify(suggestions)}</div>
      <div data-testid="suggestions-loading">{isLoading ? "loading" : "idle"}</div>
      <button data-testid="reload-suggestions" onClick={handleReload}>
        Reload
      </button>
      <button data-testid="clear-suggestions" onClick={handleClear}>
        Clear
      </button>
    </div>
  );
};

describe("useSuggestions E2E", () => {
  describe("Basic functionality", () => {
    it("tracks suggestions stream and loading state", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Take path A", isLoading: false },
        { title: "Option B", message: "Take path B", isLoading: false },
      ]);

      const ui = renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");

      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("loading");
      });

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
      });

      expect(screen.getByTestId("suggestions-json").textContent).toContain("Option A");
      expect(screen.getByTestId("suggestions-json").textContent).toContain("Option B");

      fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      });

      expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");

      ui.unmount();
    });

    it("starts with no suggestions and idle state", () => {
      const agent = new SuggestionsProviderAgent([]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
      expect(screen.getByTestId("suggestions-json").textContent).toBe("[]");
    });

    it("handles single suggestion", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Only Option", message: "The only way", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("1");
      });

      const json = screen.getByTestId("suggestions-json").textContent;
      expect(json).toContain("Only Option");
      expect(json).toContain("The only way");
    });

    it("handles many suggestions", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option 1", message: "First choice", isLoading: false },
        { title: "Option 2", message: "Second choice", isLoading: false },
        { title: "Option 3", message: "Third choice", isLoading: false },
        { title: "Option 4", message: "Fourth choice", isLoading: false },
        { title: "Option 5", message: "Fifth choice", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("5");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
      });
    });
  });

  describe("Loading state transitions", () => {
    it("transitions from idle -> loading -> idle correctly", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Test", message: "Message", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      // Initial state
      expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");

      // Trigger reload
      fireEvent.click(screen.getByTestId("reload-suggestions"));

      // Should transition to loading
      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("loading");
      });

      // Should transition back to idle
      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
      });
    });

    it("stays in loading state during multiple reloads", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Test", message: "Message", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      // Trigger multiple reloads quickly
      fireEvent.click(screen.getByTestId("reload-suggestions"));
      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("loading");
      });

      // Eventually should complete and go to idle
      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
      });
    });
  });

  describe("Clear functionality", () => {
    it("clears suggestions immediately without loading state", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Message A", isLoading: false },
        { title: "Option B", message: "Message B", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      // Load suggestions first
      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
      });

      // Clear suggestions
      fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      });

      // Should not show loading state during clear
      expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
    });

    it("can clear suggestions while loading", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Message A", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      // Start loading
      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("loading");
      });

      // Clear while loading
      fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
      });
    });

    it("clearing empty suggestions does not cause errors", async () => {
      const agent = new SuggestionsProviderAgent([]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      expect(screen.getByTestId("suggestions-count").textContent).toBe("0");

      // Clear when already empty
      fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      });

      expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
    });
  });

  describe("Reload functionality", () => {
    it("can reload to get fresh suggestions", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Message A", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      // First load
      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("1");
      });

      // Clear
      fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      });

      // Reload again
      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("1");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
      });
    });

    it("reload when already has suggestions replaces them", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Message A", isLoading: false },
        { title: "Option B", message: "Message B", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      // First load
      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
      });

      // Reload without clearing
      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("loading");
      });

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
      });
    });
  });

  describe("Edge cases", () => {
    it("handles empty suggestions from agent", async () => {
      const agent = new SuggestionsProviderAgent([]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe("idle");
      });

      expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
    });

    it("handles suggestions with special characters", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option with \"quotes\"", message: "Message with 'quotes'", isLoading: false },
        { title: "Option with\nnewlines", message: "Message\nwith\nnewlines", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: <TestHarness />,
      });

      fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
      });

      const json = screen.getByTestId("suggestions-json").textContent;
      expect(json).toContain("quotes");
      expect(json).toContain("newlines");
    });
  });
});
