import { defineComponent, onUnmounted } from "vue";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/vue";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { describe, it, expect, afterEach } from "vitest";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";
import { useSuggestions } from "../use-suggestions";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { SuggestionsProviderAgent } from "../../__tests__/utils/agents";

const TestHarness = defineComponent({
  setup() {
    const { suggestions, isLoading, reloadSuggestions, clearSuggestions } =
      useSuggestions();
    const { copilotkit } = useCopilotKit();

    const configId = copilotkit.value.addSuggestionsConfig({
      instructions: "Return deterministic suggestions",
      providerAgentId: DEFAULT_AGENT_ID,
      consumerAgentId: DEFAULT_AGENT_ID,
      available: "always",
    });

    onUnmounted(() => {
      copilotkit.value.removeSuggestionsConfig(configId);
    });

    const handleReload = () => {
      reloadSuggestions();
    };

    const handleClear = () => {
      clearSuggestions();
    };

    return {
      suggestions,
      isLoading,
      handleReload,
      handleClear,
    };
  },
  template: `
    <div>
      <div data-testid="suggestions-count">{{ suggestions.length }}</div>
      <div data-testid="suggestions-json">{{ JSON.stringify(suggestions) }}</div>
      <div data-testid="suggestions-loading">{{ isLoading ? "loading" : "idle" }}</div>
      <button data-testid="reload-suggestions" @click="handleReload">Reload</button>
      <button data-testid="clear-suggestions" @click="handleClear">Clear</button>
    </div>
  `,
});

afterEach(() => {
  cleanup();
});

describe("useSuggestions E2E", () => {
  describe("Basic functionality", () => {
    it("tracks suggestions stream and loading state", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Take path A", isLoading: false },
        { title: "Option B", message: "Take path B", isLoading: false },
      ]);

      const ui = renderWithCopilotKit({
        agent,
        children: TestHarness,
      });

      expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      expect(screen.getByTestId("suggestions-loading").textContent).toBe(
        "idle",
      );

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "loading",
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "idle",
        );
      });

      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "Option A",
      );
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "Option B",
      );

      await fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      });

      expect(screen.getByTestId("suggestions-loading").textContent).toBe(
        "idle",
      );

      ui.unmount();
    });

    it("starts with no suggestions and idle state", () => {
      const agent = new SuggestionsProviderAgent([]);

      renderWithCopilotKit({
        agent,
        children: TestHarness,
      });

      expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      expect(screen.getByTestId("suggestions-loading").textContent).toBe(
        "idle",
      );
      expect(screen.getByTestId("suggestions-json").textContent).toBe("[]");
    });

    it("handles single suggestion", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Only Option", message: "The only way", isLoading: false },
      ]);

      renderWithCopilotKit({
        agent,
        children: TestHarness,
      });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

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
        children: TestHarness,
      });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("5");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "idle",
        );
      });
    });
  });

  describe("Loading state transitions", () => {
    it("transitions from idle -> loading -> idle correctly", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Test", message: "Message", isLoading: false },
      ]);

      renderWithCopilotKit({ agent, children: TestHarness });

      expect(screen.getByTestId("suggestions-loading").textContent).toBe(
        "idle",
      );

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "loading",
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "idle",
        );
      });
    });

    it("stays in loading state during multiple reloads", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Test", message: "Message", isLoading: false },
      ]);

      renderWithCopilotKit({ agent, children: TestHarness });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));
      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "loading",
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "idle",
        );
      });
    });
  });

  describe("Clear functionality", () => {
    it("clears suggestions immediately without loading state", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Message A", isLoading: false },
        { title: "Option B", message: "Message B", isLoading: false },
      ]);

      renderWithCopilotKit({ agent, children: TestHarness });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
      });

      await fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      });

      expect(screen.getByTestId("suggestions-loading").textContent).toBe(
        "idle",
      );
    });

    it("can clear suggestions while loading", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Message A", isLoading: false },
      ]);

      renderWithCopilotKit({ agent, children: TestHarness });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "loading",
        );
      });

      await fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "idle",
        );
      });
    });

    it("clearing empty suggestions does not cause errors", async () => {
      const agent = new SuggestionsProviderAgent([]);

      renderWithCopilotKit({ agent, children: TestHarness });

      expect(screen.getByTestId("suggestions-count").textContent).toBe("0");

      await fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      });

      expect(screen.getByTestId("suggestions-loading").textContent).toBe(
        "idle",
      );
    });
  });

  describe("Reload functionality", () => {
    it("can reload to get fresh suggestions", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Message A", isLoading: false },
      ]);

      renderWithCopilotKit({ agent, children: TestHarness });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("1");
      });

      await fireEvent.click(screen.getByTestId("clear-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
      });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("1");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "idle",
        );
      });
    });

    it("reload when already has suggestions replaces them", async () => {
      const agent = new SuggestionsProviderAgent([
        { title: "Option A", message: "Message A", isLoading: false },
        { title: "Option B", message: "Message B", isLoading: false },
      ]);

      renderWithCopilotKit({ agent, children: TestHarness });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
      });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "loading",
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "idle",
        );
      });
    });
  });

  describe("Edge cases", () => {
    it("handles empty suggestions from agent", async () => {
      const agent = new SuggestionsProviderAgent([]);

      renderWithCopilotKit({ agent, children: TestHarness });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-loading").textContent).toBe(
          "idle",
        );
      });

      expect(screen.getByTestId("suggestions-count").textContent).toBe("0");
    });

    it("handles suggestions with special characters", async () => {
      const agent = new SuggestionsProviderAgent([
        {
          title: 'Option with "quotes"',
          message: "Message with 'quotes'",
          isLoading: false,
        },
        {
          title: "Option with\nnewlines",
          message: "Message\nwith\nnewlines",
          isLoading: false,
        },
      ]);

      renderWithCopilotKit({ agent, children: TestHarness });

      await fireEvent.click(screen.getByTestId("reload-suggestions"));

      await waitFor(() => {
        expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
      });

      const json = screen.getByTestId("suggestions-json").textContent;
      expect(json).toContain("quotes");
      expect(json).toContain("newlines");
    });
  });
});
