import { defineComponent, reactive, ref } from "vue";
import { fireEvent, screen, waitFor, cleanup } from "@testing-library/vue";
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type { AbstractAgent } from "@ag-ui/client";
import { useConfigureSuggestions } from "../use-configure-suggestions";
import { useSuggestions } from "../use-suggestions";
import { useCopilotKit } from "../../providers/useCopilotKit";
import {
  renderWithCopilotKit,
  MockStepwiseAgent,
  runStartedEvent,
  runFinishedEvent,
} from "../../__tests__/utils/test-helpers";
import {
  SuggestionsProviderAgent,
  StateCapturingAgent,
} from "../../__tests__/utils/agents";

afterEach(() => {
  cleanup();
});

class ImmediateSuggestionsProviderAgent extends SuggestionsProviderAgent {
  constructor(responses: any[]) {
    super(responses, DEFAULT_AGENT_ID);
  }
}

describe("useConfigureSuggestions", () => {
  it("registers suggestions config and surfaces generated suggestions", async () => {
    const agent = new ImmediateSuggestionsProviderAgent([
      { title: "Option A", message: "Take path A", isLoading: false },
      { title: "Option B", message: "Take path B", isLoading: false },
    ]);

    const TestHarness = defineComponent({
      setup() {
        useConfigureSuggestions({
          instructions: "Return deterministic suggestions",
          providerAgentId: DEFAULT_AGENT_ID,
          available: "always",
        });

        const { suggestions, isLoading, reloadSuggestions } = useSuggestions();
        return { suggestions, isLoading, reloadSuggestions };
      },
      template: `
        <div>
          <div data-testid="suggestions-count">{{ suggestions.length }}</div>
          <div data-testid="suggestions-json">{{ JSON.stringify(suggestions) }}</div>
          <div data-testid="suggestions-loading">{{ isLoading ? "loading" : "idle" }}</div>
          <button data-testid="reload-suggestions" @click="reloadSuggestions">Reload</button>
        </div>
      `,
    });

    renderWithCopilotKit({ agent, children: TestHarness });

    await waitFor(() => {
      expect(screen.getByTestId("suggestions-count").textContent).toBe("2");
      expect(screen.getByTestId("suggestions-loading").textContent).toBe(
        "idle",
      );
    });
  });
});

describe("global suggestions coverage", () => {
  it("applies updates across all agents when consumerAgentId is undefined", async () => {
    const alpha = new StateCapturingAgent([{ newMessages: [] }], "alpha");
    const beta = new StateCapturingAgent([{ newMessages: [] }], "beta");
    const config = reactive<any>({
      suggestions: [{ title: "Global v1", message: "Global v1" }],
      consumerAgentId: undefined,
    });

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions(config);
        const { suggestions: alphaSuggestions } = useSuggestions({
          agentId: "alpha",
        });
        const { suggestions: betaSuggestions } = useSuggestions({
          agentId: "beta",
        });
        const updateGlobal = () => {
          config.suggestions = [{ title: "Global v2", message: "Global v2" }];
        };
        return { alphaSuggestions, betaSuggestions, updateGlobal };
      },
      template: `
        <div>
          <div data-testid="alpha-json">{{ JSON.stringify(alphaSuggestions) }}</div>
          <div data-testid="beta-json">{{ JSON.stringify(betaSuggestions) }}</div>
          <button data-testid="update-global" @click="updateGlobal">Update Global Suggestions</button>
        </div>
      `,
    });

    renderWithCopilotKit({
      agents: {
        alpha: alpha as unknown as AbstractAgent,
        beta: beta as unknown as AbstractAgent,
      },
      agentId: "alpha",
      children: Harness,
    });

    expect(screen.getByTestId("alpha-json").textContent).toContain("Global v1");
    expect(screen.getByTestId("beta-json").textContent).toContain("Global v1");

    await fireEvent.click(screen.getByTestId("update-global"));

    await waitFor(() => {
      expect(screen.getByTestId("alpha-json").textContent).toContain(
        "Global v2",
      );
      expect(screen.getByTestId("beta-json").textContent).toContain(
        "Global v2",
      );
    });
  });

  it("applies updates across all agents when consumerAgentId is '*'", async () => {
    const alpha = new StateCapturingAgent([{ newMessages: [] }], "alpha");
    const beta = new StateCapturingAgent([{ newMessages: [] }], "beta");
    const config = reactive<any>({
      suggestions: [{ title: "Global v1", message: "Global v1" }],
      consumerAgentId: "*",
    });

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions(config);
        const { suggestions: alphaSuggestions } = useSuggestions({
          agentId: "alpha",
        });
        const { suggestions: betaSuggestions } = useSuggestions({
          agentId: "beta",
        });
        const updateGlobal = () => {
          config.suggestions = [{ title: "Global v2", message: "Global v2" }];
        };
        return { alphaSuggestions, betaSuggestions, updateGlobal };
      },
      template: `
        <div>
          <div data-testid="alpha-json">{{ JSON.stringify(alphaSuggestions) }}</div>
          <div data-testid="beta-json">{{ JSON.stringify(betaSuggestions) }}</div>
          <button data-testid="update-global" @click="updateGlobal">Update Global Suggestions</button>
        </div>
      `,
    });

    renderWithCopilotKit({
      agents: {
        alpha: alpha as unknown as AbstractAgent,
        beta: beta as unknown as AbstractAgent,
      },
      agentId: "alpha",
      children: Harness,
    });

    await fireEvent.click(screen.getByTestId("update-global"));

    await waitFor(() => {
      expect(screen.getByTestId("alpha-json").textContent).toContain(
        "Global v2",
      );
      expect(screen.getByTestId("beta-json").textContent).toContain(
        "Global v2",
      );
    });
  });
});

describe("dynamic suggestions with MockAgent", () => {
  it("reloads streaming suggestions when instructions change", async () => {
    const provider = new ImmediateSuggestionsProviderAgent([
      { title: "Alpha", message: "Alpha", isLoading: false },
    ]);
    const topic = ref("Alpha");

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions(
          {
            instructions: `Offer choices about ${topic.value}`,
            providerAgentId: DEFAULT_AGENT_ID,
            consumerAgentId: DEFAULT_AGENT_ID,
            available: "always",
          },
          [topic],
        );

        const { suggestions, reloadSuggestions } = useSuggestions();
        const nextTopic = () => {
          topic.value = "Beta";
          provider.setResponses([
            { title: "Beta", message: "Beta", isLoading: false },
          ]);
        };
        return { suggestions, reloadSuggestions, nextTopic };
      },
      template: `
        <div>
          <div data-testid="dynamic-json">{{ JSON.stringify(suggestions) }}</div>
          <button data-testid="dynamic-reload" @click="reloadSuggestions">Reload Dynamic</button>
          <button data-testid="dynamic-topic" @click="nextTopic">Next Topic</button>
        </div>
      `,
    });

    renderWithCopilotKit({ agent: provider, children: Harness });

    await fireEvent.click(screen.getByTestId("dynamic-reload"));
    await waitFor(() => {
      expect(screen.getByTestId("dynamic-json").textContent).toContain("Alpha");
    });

    await fireEvent.click(screen.getByTestId("dynamic-topic"));
    await fireEvent.click(screen.getByTestId("dynamic-reload"));

    await waitFor(() => {
      expect(screen.getByTestId("dynamic-json").textContent).toContain("Beta");
    });
  });
});

describe("static suggestions defaults", () => {
  it("shows static suggestions only before the first message", async () => {
    const agent = new MockStepwiseAgent();

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions({
          suggestions: [{ title: "Static A", message: "First static" }],
        });
        const { suggestions, reloadSuggestions } = useSuggestions();
        const { copilotkit } = useCopilotKit();

        const addMessage = () => {
          const current = copilotkit.value.getAgent(DEFAULT_AGENT_ID);
          current?.addMessage({
            id: "u1",
            role: "user",
            content: "User message",
          } as any);
          reloadSuggestions();
        };

        return { suggestions, reloadSuggestions, addMessage };
      },
      template: `
        <div>
          <div data-testid="suggestions-json">{{ JSON.stringify(suggestions) }}</div>
          <button data-testid="reload-suggestions" @click="reloadSuggestions">Reload</button>
          <button data-testid="add-message" @click="addMessage">Add message</button>
        </div>
      `,
    });

    renderWithCopilotKit({ agent, children: Harness });

    await fireEvent.click(screen.getByTestId("reload-suggestions"));
    await waitFor(() => {
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "Static A",
      );
    });

    await fireEvent.click(screen.getByTestId("add-message"));
    await waitFor(() => {
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "[]",
      );
    });
  });
});

describe("suggestions lifecycle during runs", () => {
  it("clears suggestions immediately when the agent run starts", async () => {
    const agent = new MockStepwiseAgent();

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions({
          suggestions: [{ title: "First static", message: "First static" }],
        });
        const { suggestions, reloadSuggestions } = useSuggestions();
        const { copilotkit } = useCopilotKit();

        const runAgent = () => {
          const current = copilotkit.value.getAgent(DEFAULT_AGENT_ID);
          if (current) {
            current.addMessage({
              id: "u-run",
              role: "user",
              content: "Initiating run",
            } as any);
            void copilotkit.value.runAgent({ agent: current });
          }
        };

        return { suggestions, reloadSuggestions, runAgent };
      },
      template: `
        <div>
          <div data-testid="suggestions-json">{{ JSON.stringify(suggestions) }}</div>
          <button data-testid="reload-suggestions" @click="reloadSuggestions">Reload</button>
          <button data-testid="run-agent" @click="runAgent">Run</button>
        </div>
      `,
    });

    renderWithCopilotKit({ agent, children: Harness });

    await fireEvent.click(screen.getByTestId("reload-suggestions"));
    await waitFor(() => {
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "First static",
      );
    });

    await fireEvent.click(screen.getByTestId("run-agent"));
    agent.emit(runStartedEvent());

    await waitFor(() => {
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "[]",
      );
    });

    agent.emit(runFinishedEvent());
    agent.complete();
  });
});

describe("useConfigureSuggestions dependencies", () => {
  it("reloads suggestions when the provided config changes", async () => {
    const provider = new ImmediateSuggestionsProviderAgent([
      { title: "Version 0", message: "Version 0", isLoading: false },
    ]);
    const version = ref(0);

    const Harness = defineComponent({
      setup() {
        const config = reactive({
          instructions: "Versioned suggestions",
          providerAgentId: DEFAULT_AGENT_ID,
          consumerAgentId: DEFAULT_AGENT_ID,
          available: "always" as const,
          version,
        });

        useConfigureSuggestions(config, [version]);
        const { suggestions } = useSuggestions();

        const bump = () => {
          version.value += 1;
          provider.setResponses([
            {
              title: `Version ${version.value}`,
              message: `Version ${version.value}`,
              isLoading: false,
            },
          ]);
        };

        return { suggestions, bump };
      },
      template: `
        <div>
          <div data-testid="suggestions-json">{{ JSON.stringify(suggestions) }}</div>
          <button data-testid="bump" @click="bump">Bump</button>
        </div>
      `,
    });

    renderWithCopilotKit({ agent: provider, children: Harness });

    await waitFor(() => {
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "Version 0",
      );
    });

    await fireEvent.click(screen.getByTestId("bump"));

    await waitFor(() => {
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "Version 1",
      );
    });
  });

  it("reloads suggestions when optional dependencies change", async () => {
    const provider = new ImmediateSuggestionsProviderAgent([
      { title: "Initial", message: "Initial", isLoading: false },
    ]);
    const version = ref(0);

    const Harness = defineComponent({
      setup() {
        const configRef = ref({
          suggestions: [{ title: "Version 0", message: "Version 0" }],
        });

        useConfigureSuggestions(configRef.value, [version]);
        const { suggestions } = useSuggestions();

        const bump = () => {
          version.value += 1;
          configRef.value.suggestions = [
            {
              title: `Version ${version.value}`,
              message: `Version ${version.value}`,
            },
          ];
          provider.setResponses([
            {
              title: `Version ${version.value}`,
              message: `Version ${version.value}`,
              isLoading: false,
            },
          ]);
        };

        return { suggestions, bump };
      },
      template: `
        <div>
          <div data-testid="suggestions-json">{{ JSON.stringify(suggestions) }}</div>
          <button data-testid="bump" @click="bump">Bump</button>
        </div>
      `,
    });

    renderWithCopilotKit({ agent: provider, children: Harness });

    await fireEvent.click(screen.getByTestId("bump"));

    await waitFor(() => {
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "Version 1",
      );
    });
  });

  it("defers reloads while a run is in progress and applies them afterward", async () => {
    const agent = new MockStepwiseAgent();
    const label = ref("Initial");

    const Harness = defineComponent({
      setup() {
        const config = reactive({
          suggestions: [{ title: label.value, message: label.value }],
        });

        useConfigureSuggestions(config, [label]);

        const { copilotkit } = useCopilotKit();
        const { suggestions } = useSuggestions();

        const startRun = () => {
          const current = copilotkit.value.getAgent(DEFAULT_AGENT_ID);
          if (current) {
            void copilotkit.value.runAgent({ agent: current });
          }
        };
        const emitStart = async () => {
          const current = copilotkit.value.getAgent(DEFAULT_AGENT_ID);
          if (current instanceof MockStepwiseAgent) {
            await current.emit(runStartedEvent());
          }
        };
        const emitFinish = async () => {
          const current = copilotkit.value.getAgent(DEFAULT_AGENT_ID);
          if (current instanceof MockStepwiseAgent) {
            await current.emit(runFinishedEvent());
            await current.complete();
          }
        };

        const updateLabel = () => {
          label.value = "Deferred";
          config.suggestions = [{ title: label.value, message: label.value }];
        };

        return { suggestions, startRun, emitStart, emitFinish, updateLabel };
      },
      template: `
        <div>
          <div data-testid="suggestions-json">{{ JSON.stringify(suggestions) }}</div>
          <button data-testid="start-run" @click="startRun">Start Run</button>
          <button data-testid="emit-start" @click="emitStart">Emit Start</button>
          <button data-testid="emit-finish" @click="emitFinish">Emit Finish</button>
          <button data-testid="update-label" @click="updateLabel">Update Label</button>
        </div>
      `,
    });

    renderWithCopilotKit({ agent, children: Harness });

    await waitFor(() => {
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "Initial",
      );
    });

    await fireEvent.click(screen.getByTestId("start-run"));
    await fireEvent.click(screen.getByTestId("emit-start"));

    await fireEvent.click(screen.getByTestId("update-label"));

    expect(screen.getByTestId("suggestions-json").textContent).toContain("[]");

    await fireEvent.click(screen.getByTestId("emit-finish"));

    await waitFor(() => {
      expect(screen.getByTestId("suggestions-json").textContent).toContain(
        "Deferred",
      );
    });
  });
});
