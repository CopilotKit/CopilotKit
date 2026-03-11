import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import type {
  AbstractAgent,
  AgentSubscriber,
  BaseEvent,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import { Observable } from "rxjs";
import { useConfigureSuggestions } from "../use-configure-suggestions";
import { useSuggestions } from "../use-suggestions";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { mountWithProvider } from "../../__tests__/utils/mount";
import { StateCapturingAgent, SuggestionsProviderAgent } from "../../__tests__/utils/agents";

class LongRunningAgent extends StateCapturingAgent {
  private finalizeRun: (() => void) | null = null;

  constructor(agentId = DEFAULT_AGENT_ID) {
    super([], agentId);
  }

  finish(): void {
    this.finalizeRun?.();
    this.finalizeRun = null;
  }

  run(): Observable<BaseEvent> {
    throw new Error("LongRunningAgent.run() should not be used in tests");
  }

  override async runAgent(
    parameters: RunAgentParameters = {},
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const input = this.prepareRunAgentInput(parameters);
    this.lastRunInput = input;
    this.isRunning = true;

    await subscriber?.onRunInitialized?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    await new Promise<void>((resolve) => {
      this.finalizeRun = resolve;
    });

    await subscriber?.onRunFinalized?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    this.isRunning = false;
    return { newMessages: [] };
  }
}

describe("useConfigureSuggestions", () => {
  beforeEach(() => {
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  it("registers dynamic config and surfaces generated suggestions", async () => {
    const provider = new SuggestionsProviderAgent(
      [
        { title: "Option A", message: "Take path A", isLoading: false },
        { title: "Option B", message: "Take path B", isLoading: false },
      ],
      DEFAULT_AGENT_ID,
    );

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions({
          instructions: "Return deterministic suggestions",
          providerAgentId: DEFAULT_AGENT_ID,
          consumerAgentId: DEFAULT_AGENT_ID,
          available: "always",
        });
        const { suggestions, isLoading } = useSuggestions();
        return () =>
          h("div", [
            h("span", { "data-testid": "count" }, String(suggestions.value.length)),
            h("span", { "data-testid": "loading" }, isLoading.value ? "loading" : "idle"),
            h("span", { "data-testid": "json" }, JSON.stringify(suggestions.value)),
          ]);
      },
    });

    const { wrapper } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: { [DEFAULT_AGENT_ID]: provider as unknown as AbstractAgent },
    });

    await nextTick();
    await nextTick();
    await nextTick();

    await vi.waitFor(() => {
      expect(wrapper.find("[data-testid=loading]").text()).toBe("idle");
      expect(wrapper.find("[data-testid=count]").text()).toBe("2");
    });
    expect(wrapper.find("[data-testid=json]").text()).toContain("Option A");
    expect(wrapper.find("[data-testid=json]").text()).toContain("Option B");
  });

  it("applies global updates across all agents (undefined and '*')", async () => {
    const alpha = new StateCapturingAgent([{ newMessages: [] }], "alpha");
    const beta = new StateCapturingAgent([{ newMessages: [] }], "beta");
    const mode = ref<undefined | "*">(undefined);
    const config = reactive<{
      suggestions: Array<{ title: string; message: string }>;
      consumerAgentId?: "*";
    }>({
      suggestions: [{ title: "Global v1", message: "Global v1" }],
      consumerAgentId: undefined,
    });

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions(config, [mode]);

        const { suggestions: alphaSuggestions } = useSuggestions({ agentId: "alpha" });
        const { suggestions: betaSuggestions } = useSuggestions({ agentId: "beta" });

        return () =>
          h("div", [
            h("span", { "data-testid": "alpha" }, JSON.stringify(alphaSuggestions.value)),
            h("span", { "data-testid": "beta" }, JSON.stringify(betaSuggestions.value)),
            h(
              "button",
              {
                "data-testid": "update",
                onClick: () => {
                  config.suggestions = [{ title: "Global v2", message: "Global v2" }];
                },
              },
              "update",
            ),
            h(
              "button",
              {
                "data-testid": "mode-star",
                onClick: () => {
                  mode.value = "*";
                  config.consumerAgentId = "*";
                },
              },
              "star",
            ),
          ]);
      },
    });

    const { wrapper } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: {
        alpha: alpha as unknown as AbstractAgent,
        beta: beta as unknown as AbstractAgent,
      },
    });

    await nextTick();
    expect(wrapper.find("[data-testid=alpha]").text()).toContain("Global v1");
    expect(wrapper.find("[data-testid=beta]").text()).toContain("Global v1");

    await wrapper.find("[data-testid=update]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid=alpha]").text()).toContain("Global v2");
    expect(wrapper.find("[data-testid=beta]").text()).toContain("Global v2");

    await wrapper.find("[data-testid=mode-star]").trigger("click");
    await wrapper.find("[data-testid=update]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid=alpha]").text()).toContain("Global v2");
    expect(wrapper.find("[data-testid=beta]").text()).toContain("Global v2");
  });

  it("reloads suggestions when deps change with stable config object", async () => {
    const provider = new SuggestionsProviderAgent(
      [{ title: "Version 0", message: "Version 0", isLoading: false }],
      DEFAULT_AGENT_ID,
    );

    const version = ref(0);
    const config = {
      instructions: "Versioned suggestions",
      providerAgentId: DEFAULT_AGENT_ID,
      consumerAgentId: DEFAULT_AGENT_ID,
      available: "always" as const,
    };

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions(config, [version]);
        const { suggestions } = useSuggestions();
        return () =>
          h("div", [
            h("span", { "data-testid": "json" }, JSON.stringify(suggestions.value)),
            h(
              "button",
              {
                "data-testid": "bump",
                onClick: () => {
                  version.value += 1;
                  provider.setResponses([
                    { title: `Version ${version.value}`, message: `Version ${version.value}`, isLoading: false },
                  ]);
                },
              },
              "bump",
            ),
          ]);
      },
    });

    const { wrapper } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: { [DEFAULT_AGENT_ID]: provider as unknown as AbstractAgent },
    });

    await nextTick();
    await nextTick();
    expect(wrapper.find("[data-testid=json]").text()).toContain("Version 0");

    await wrapper.find("[data-testid=bump]").trigger("click");
    await nextTick();
    await nextTick();

    expect(wrapper.find("[data-testid=json]").text()).toContain("Version 1");
  });

  it("triggers a single reload per dependency change", async () => {
    const provider = new SuggestionsProviderAgent(
      [{ title: "Initial", message: "Initial", isLoading: false }],
      DEFAULT_AGENT_ID,
    );
    const version = ref(0);
    const config = {
      instructions: "Single reload check",
      providerAgentId: DEFAULT_AGENT_ID,
      consumerAgentId: DEFAULT_AGENT_ID,
      available: "always" as const,
    };

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions(config, [version]);
        return () =>
          h(
            "button",
            {
              "data-testid": "bump",
              onClick: () => {
                version.value += 1;
              },
            },
            "bump",
          );
      },
    });

    const { wrapper, getCore } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: { [DEFAULT_AGENT_ID]: provider as unknown as AbstractAgent },
    });

    await nextTick();
    await nextTick();
    const reloadSpy = vi.spyOn(getCore(), "reloadSuggestions");
    reloadSpy.mockClear();

    await wrapper.find("[data-testid=bump]").trigger("click");
    await nextTick();
    await nextTick();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("clears suggestions when run starts and applies deferred update after run finishes", async () => {
    const runner = new LongRunningAgent(DEFAULT_AGENT_ID);
    const config = reactive<{ suggestions: Array<{ title: string; message: string }> }>({
      suggestions: [{ title: "Initial", message: "Initial" }],
    });

    const Harness = defineComponent({
      setup() {
        useConfigureSuggestions(config);
        const { suggestions } = useSuggestions();
        const { copilotkit } = useCopilotKit();
        const startRun = () => void copilotkit.value.runAgent({ agent: runner });

        return () =>
          h("div", [
            h("span", { "data-testid": "json" }, JSON.stringify(suggestions.value)),
            h("button", { "data-testid": "start", onClick: startRun }, "start"),
            h(
              "button",
              {
                "data-testid": "update",
                onClick: () => {
                  config.suggestions = [{ title: "Deferred", message: "Deferred" }];
                },
              },
              "update",
            ),
            h("button", { "data-testid": "finish", onClick: () => runner.finish() }, "finish"),
          ]);
      },
    });

    const { wrapper } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: { [DEFAULT_AGENT_ID]: runner as unknown as AbstractAgent },
    });

    await nextTick();
    expect(wrapper.find("[data-testid=json]").text()).toContain("Initial");

    await wrapper.find("[data-testid=start]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid=json]").text()).toContain("[]");

    await wrapper.find("[data-testid=update]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid=json]").text()).toContain("[]");

    await wrapper.find("[data-testid=finish]").trigger("click");
    await nextTick();
    await nextTick();

    expect(wrapper.find("[data-testid=json]").text()).toContain("Deferred");
  });
});
