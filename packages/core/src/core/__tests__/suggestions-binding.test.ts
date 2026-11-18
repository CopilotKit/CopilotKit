import { afterEach, describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Subject } from "rxjs";
import type { Observable } from "rxjs";
import { CopilotKitCore } from "../core";
import type {
  CopilotKitCoreGetSuggestionsResult,
  CopilotKitCoreSubscriber,
} from "../core";
import {
  ɵbindSuggestionsConfig,
  ɵsubscribeToAgentSuggestions,
} from "../suggestions-binding";
import type { ɵSuggestionsConfigInput } from "../suggestions-binding";

/** An agent whose run stays open until the test finishes it. */
class ControlledAgent extends AbstractAgent {
  #events = new Subject<BaseEvent>();

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.#events.asObservable();
  }

  /** Starts a run and resolves once the run has subscribed to its events. */
  async start() {
    const run = this.runAgent();
    await nextTask();
    this.#events.next({
      type: EventType.RUN_STARTED,
      threadId: this.threadId,
      runId: "run",
    } as BaseEvent);
    return {
      finish: async () => {
        this.#events.next({
          type: EventType.RUN_FINISHED,
          threadId: this.threadId,
          runId: "run",
        } as BaseEvent);
        this.#events.complete();
        await run;
      },
    };
  }
}

const welcome = { title: "Hi", message: "Say hi" };
const STATIC_GLOBAL: ɵSuggestionsConfigInput = {
  suggestions: [welcome],
  available: "always",
};

interface TestAccess {
  notifySubscribers(
    handler: (subscriber: CopilotKitCoreSubscriber) => void | Promise<void>,
    errorMessage: string,
  ): Promise<void>;
}

const bindings: { dispose(): void }[] = [];
function bind(...args: Parameters<typeof ɵbindSuggestionsConfig>) {
  const binding = ɵbindSuggestionsConfig(...args);
  bindings.push(binding);
  return binding;
}

function titles(core: CopilotKitCore, agentId: string) {
  return core.getSuggestions(agentId).suggestions.map((s) => s.title);
}

function countConfigChanges(core: CopilotKitCore) {
  const sizes: number[] = [];
  core.subscribe({
    onSuggestionsConfigChanged: ({ suggestionsConfig }) => {
      sizes.push(Object.keys(suggestionsConfig).length);
    },
  });
  return sizes;
}

/** Counts reloads of an agent: each reload first clears its suggestions. */
function countReloads(core: CopilotKitCore, agentId: string) {
  const reloads = { count: 0 };
  core.subscribe({
    onSuggestionsChanged: (event) => {
      if (event.agentId === agentId && event.suggestions.length === 0) {
        reloads.count += 1;
      }
    },
  });
  return reloads;
}

async function nextTask() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Longer than the binding's retry check interval. */
async function afterRetryCheck() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

afterEach(() => {
  for (const binding of bindings.splice(0)) binding.dispose();
});

describe("ɵbindSuggestionsConfig", () => {
  it("shows a global static config for the chat agent before any agent registers", () => {
    const core = new CopilotKitCore({});

    bind(core, STATIC_GLOBAL, { chatAgentId: "support" });

    expect(titles(core, "support")).toEqual(["Hi"]);
  });

  it("reloads every idle registered agent for a global config", () => {
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: {
        a: new ControlledAgent(),
        b: new ControlledAgent(),
      },
    });

    bind(core, STATIC_GLOBAL, { chatAgentId: "a" });

    expect(titles(core, "a")).toEqual(["Hi"]);
    expect(titles(core, "b")).toEqual(["Hi"]);
  });

  it("loads a targeted config for its consumer agent, not the chat agent", () => {
    const core = new CopilotKitCore({});

    bind(
      core,
      { ...STATIC_GLOBAL, consumerAgentId: "billing" },
      { chatAgentId: "support" },
    );

    expect(titles(core, "billing")).toEqual(["Hi"]);
    expect(titles(core, "support")).toEqual([]);
  });

  it("registers nothing for a disabled config", () => {
    const core = new CopilotKitCore({});
    const configChanges = countConfigChanges(core);

    bind(core, { ...STATIC_GLOBAL, available: "disabled" });

    expect(configChanges).toEqual([]);
    expect(titles(core, "default")).toEqual([]);
  });

  it("keeps one registration for configs with equal content", async () => {
    const core = new CopilotKitCore({});
    const configChanges = countConfigChanges(core);
    const binding = bind(core, STATIC_GLOBAL);

    binding.update({ suggestions: [{ ...welcome }], available: "always" });
    binding.update({
      suggestions: [{ ...welcome, isLoading: false }],
      available: "always",
    });

    await nextTask();
    expect(configChanges).toEqual([1]);
  });

  it("replaces the registration when the config content changes", async () => {
    const core = new CopilotKitCore({});
    const binding = bind(core, STATIC_GLOBAL);

    binding.update({
      suggestions: [{ title: "Bye", message: "Say bye" }],
      available: "always",
    });

    expect(titles(core, "default")).toEqual(["Bye"]);
  });

  it("reloads for the new chat agent when only the chat agent changes", () => {
    const core = new CopilotKitCore({});
    const binding = bind(core, STATIC_GLOBAL, { chatAgentId: "a" });

    binding.update(STATIC_GLOBAL, { chatAgentId: "b" });

    expect(titles(core, "b")).toEqual(["Hi"]);
  });

  it("removes the config on dispose", async () => {
    const core = new CopilotKitCore({});
    const configChanges = countConfigChanges(core);
    const binding = bind(core, STATIC_GLOBAL);

    binding.dispose();
    core.reloadSuggestions("default");

    await nextTask();
    expect(configChanges).toEqual([1, 0]);
    expect(titles(core, "default")).toEqual([]);
  });

  describe("agents that are running", () => {
    it("skips a running agent and reloads it once its run ends", async () => {
      const agent = new ControlledAgent();
      const core = new CopilotKitCore({
        agents__unsafe_dev_only: { a: agent },
      });
      const run = await agent.start();

      bind(core, STATIC_GLOBAL, { chatAgentId: "a" });
      expect(titles(core, "a")).toEqual([]);

      await run.finish();
      await afterRetryCheck();

      expect(titles(core, "a")).toEqual(["Hi"]);
    });

    it("does not reload again when core reloaded the agent after its run", async () => {
      const agent = new ControlledAgent();
      const core = new CopilotKitCore({
        agents__unsafe_dev_only: { a: agent },
      });
      const run = await agent.start();
      bind(core, STATIC_GLOBAL, { chatAgentId: "a" });
      const reloads = countReloads(core, "a");

      await run.finish();
      // What core's run handler does right after a run it drove.
      core.reloadSuggestions("a");
      await afterRetryCheck();

      expect(reloads.count).toBe(1);
    });

    it("drops the retry when disposed before the run ends", async () => {
      const agent = new ControlledAgent();
      const core = new CopilotKitCore({
        agents__unsafe_dev_only: { a: agent },
      });
      const run = await agent.start();
      const binding = bind(core, STATIC_GLOBAL, { chatAgentId: "a" });

      binding.dispose();
      await run.finish();
      await afterRetryCheck();

      expect(titles(core, "a")).toEqual([]);
    });
  });

  it("reloads a dynamic config once its agent registers, and only then", async () => {
    const core = new CopilotKitCore({});
    bind(
      core,
      { instructions: "Suggest next steps", available: "always" },
      { chatAgentId: "late" },
    );
    const reloads = countReloads(core, "late");

    core.addAgent__unsafe_dev_only({
      id: "other",
      agent: new ControlledAgent(),
    });
    await nextTask();
    expect(reloads.count).toBe(0);

    core.addAgent__unsafe_dev_only({
      id: "late",
      agent: new ControlledAgent(),
    });
    await nextTask();
    core.addAgent__unsafe_dev_only({
      id: "later",
      agent: new ControlledAgent(),
    });
    await nextTask();

    // One reload of "late" from the binding (the global loop also reloads
    // every other idle agent, which this counter ignores).
    expect(reloads.count).toBe(1);
  });

  it("reload() reloads again on request", () => {
    const core = new CopilotKitCore({});
    const binding = bind(core, STATIC_GLOBAL);
    const reloads = countReloads(core, "default");

    binding.reload();

    expect(reloads.count).toBe(1);
  });
});

describe("ɵsubscribeToAgentSuggestions", () => {
  function notify(
    core: CopilotKitCore,
    handler: (subscriber: CopilotKitCoreSubscriber) => void,
  ) {
    void (core as unknown as TestAccess).notifySubscribers(handler, "test");
  }

  function collect(core: CopilotKitCore, agentId: string) {
    const results: CopilotKitCoreGetSuggestionsResult[] = [];
    const unsubscribe = ɵsubscribeToAgentSuggestions(core, agentId, (r) =>
      results.push(r),
    );
    return { results, unsubscribe };
  }

  it("publishes the agent's suggestions and ignores other agents", () => {
    const core = new CopilotKitCore({});
    const { results } = collect(core, "a");
    const config = core.addSuggestionsConfig({
      suggestions: [welcome],
      available: "always",
    });

    core.reloadSuggestions("b");
    core.reloadSuggestions("a");

    expect(config).toBeTypeOf("string");
    expect(results.at(-1)).toEqual({
      suggestions: [{ ...welcome, isLoading: false }],
      isLoading: false,
    });
    expect(results.every((r) => r.suggestions.length <= 1)).toBe(true);
  });

  it("follows the loading events for the agent", () => {
    const core = new CopilotKitCore({});
    const { results } = collect(core, "a");

    notify(core, (s) =>
      s.onSuggestionsStartedLoading?.({ copilotkit: core, agentId: "a" }),
    );
    notify(core, (s) =>
      s.onSuggestionsStartedLoading?.({ copilotkit: core, agentId: "b" }),
    );
    notify(core, (s) =>
      s.onSuggestionsFinishedLoading?.({ copilotkit: core, agentId: "a" }),
    );

    expect(results.map((r) => r.isLoading)).toEqual([true, false]);
  });

  it("reads the loading flag from core when the suggestions change", () => {
    const core = new CopilotKitCore({});
    const { results } = collect(core, "a");
    notify(core, (s) =>
      s.onSuggestionsStartedLoading?.({ copilotkit: core, agentId: "a" }),
    );

    // Clearing aborts generation before any finished-loading event arrives.
    core.clearSuggestions("a");

    expect(results.map((r) => r.isLoading)).toEqual([true, false]);
  });

  it("publishes nothing when an event leaves the result unchanged", async () => {
    const core = new CopilotKitCore({});
    const { results } = collect(core, "a");

    core.addSuggestionsConfig({ suggestions: [welcome] });
    await nextTask();
    notify(core, (s) =>
      s.onSuggestionsFinishedLoading?.({ copilotkit: core, agentId: "a" }),
    );

    expect(results).toEqual([]);
  });

  it("stops after unsubscribe", () => {
    const core = new CopilotKitCore({});
    const { results, unsubscribe } = collect(core, "a");
    core.addSuggestionsConfig({ suggestions: [welcome], available: "always" });

    unsubscribe();
    core.reloadSuggestions("a");

    expect(results).toEqual([]);
  });
});

describe("ɵbindSuggestionsConfig with fake timers", () => {
  it("clears its retry timer on dispose", async () => {
    vi.useFakeTimers();
    try {
      const agent = new ControlledAgent();
      const core = new CopilotKitCore({
        agents__unsafe_dev_only: { a: agent },
      });
      const started = agent.start();
      await vi.advanceTimersByTimeAsync(0);
      const run = await started;
      const binding = bind(core, STATIC_GLOBAL, { chatAgentId: "a" });

      await run.finish();
      binding.dispose();
      await vi.runAllTimersAsync();

      expect(titles(core, "a")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
