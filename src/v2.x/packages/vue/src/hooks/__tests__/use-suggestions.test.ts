import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import type { AbstractAgent } from "@ag-ui/client";
import { useSuggestions } from "../use-suggestions";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { mountWithProvider } from "../../__tests__/utils/mount";
import { SuggestionsProviderAgent } from "../../__tests__/utils/agents";

describe("useSuggestions", () => {
  beforeEach(() => {
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  function makeHarness() {
    return defineComponent({
      setup() {
        const { suggestions, isLoading, reloadSuggestions, clearSuggestions } = useSuggestions();
        const { copilotkit } = useCopilotKit();

        const configId = copilotkit.value.addSuggestionsConfig({
          instructions: "Return deterministic suggestions",
          providerAgentId: DEFAULT_AGENT_ID,
          consumerAgentId: DEFAULT_AGENT_ID,
          available: "always",
        });

        const reload = () => reloadSuggestions();
        const clear = () => clearSuggestions();

        return () =>
          h("div", [
            h("span", { "data-testid": "count" }, String(suggestions.value.length)),
            h("span", { "data-testid": "loading" }, isLoading.value ? "loading" : "idle"),
            h("span", { "data-testid": "json" }, JSON.stringify(suggestions.value)),
            h("button", { "data-testid": "reload", onClick: reload }, "reload"),
            h("button", { "data-testid": "clear", onClick: clear }, "clear"),
            h(
              "button",
              {
                "data-testid": "remove-config",
                onClick: () => copilotkit.value.removeSuggestionsConfig(configId),
              },
              "remove",
            ),
          ]);
      },
    });
  }

  it("starts empty and idle", () => {
    const agent = new SuggestionsProviderAgent([], DEFAULT_AGENT_ID);
    const Harness = makeHarness();

    const { wrapper } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: { [DEFAULT_AGENT_ID]: agent as unknown as AbstractAgent },
    });

    expect(wrapper.find("[data-testid=count]").text()).toBe("0");
    expect(wrapper.find("[data-testid=loading]").text()).toBe("idle");
  });

  it("tracks loading lifecycle on reload", async () => {
    const agent = new SuggestionsProviderAgent(
      [
        { title: "Option A", message: "Take path A", isLoading: false },
        { title: "Option B", message: "Take path B", isLoading: false },
      ],
      DEFAULT_AGENT_ID,
    );
    const Harness = makeHarness();

    const { wrapper } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: { [DEFAULT_AGENT_ID]: agent as unknown as AbstractAgent },
    });

    await wrapper.find("[data-testid=reload]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid=loading]").text()).toBe("loading");

    await nextTick();
    await nextTick();
    expect(wrapper.find("[data-testid=loading]").text()).toBe("idle");
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
    expect(wrapper.find("[data-testid=json]").text()).toContain("Option A");
    expect(wrapper.find("[data-testid=json]").text()).toContain("Option B");
  });

  it("clears suggestions immediately and stays idle", async () => {
    const agent = new SuggestionsProviderAgent(
      [{ title: "Option A", message: "Take path A", isLoading: false }],
      DEFAULT_AGENT_ID,
    );
    const Harness = makeHarness();

    const { wrapper } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: { [DEFAULT_AGENT_ID]: agent as unknown as AbstractAgent },
    });

    await wrapper.find("[data-testid=reload]").trigger("click");
    await nextTick();
    await nextTick();

    expect(wrapper.find("[data-testid=count]").text()).toBe("1");

    await wrapper.find("[data-testid=clear]").trigger("click");
    await nextTick();

    expect(wrapper.find("[data-testid=count]").text()).toBe("0");
    expect(wrapper.find("[data-testid=loading]").text()).toBe("idle");
  });

  it("supports reload after clear and special characters", async () => {
    const agent = new SuggestionsProviderAgent(
      [
        { title: 'Option with "quotes"', message: "Message with 'quotes'", isLoading: false },
        { title: "Option with\nnewlines", message: "Message\nwith\nnewlines", isLoading: false },
      ],
      DEFAULT_AGENT_ID,
    );
    const Harness = makeHarness();

    const { wrapper } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: { [DEFAULT_AGENT_ID]: agent as unknown as AbstractAgent },
    });

    await wrapper.find("[data-testid=reload]").trigger("click");
    await nextTick();
    await nextTick();

    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
    expect(wrapper.find("[data-testid=json]").text()).toContain("quotes");
    expect(wrapper.find("[data-testid=json]").text()).toContain("newlines");

    await wrapper.find("[data-testid=clear]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid=count]").text()).toBe("0");

    await wrapper.find("[data-testid=reload]").trigger("click");
    await nextTick();
    await nextTick();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it("handles multiple reload requests without leaving loading state stuck", async () => {
    const agent = new SuggestionsProviderAgent(
      [{ title: "Option", message: "Message", isLoading: false }],
      DEFAULT_AGENT_ID,
    );
    const Harness = makeHarness();

    const { wrapper } = mountWithProvider(() => h(Harness), {
      agents__unsafe_dev_only: { [DEFAULT_AGENT_ID]: agent as unknown as AbstractAgent },
    });

    await wrapper.find("[data-testid=reload]").trigger("click");
    await wrapper.find("[data-testid=reload]").trigger("click");
    await nextTick();

    expect(wrapper.find("[data-testid=loading]").text()).toBe("loading");
    await nextTick();
    await nextTick();
    expect(wrapper.find("[data-testid=loading]").text()).toBe("idle");
  });
});
