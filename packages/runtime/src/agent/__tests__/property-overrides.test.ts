/**
 * `forwardedProps` overrides. A run may replace `model`, `toolChoice`,
 * `prompt`, or `modelOptions`, but only the ones the agent lists in
 * `overridableProperties`, and only with a value of the right shape. The
 * fake model records what `chat()` sent it. A forwarded model name goes
 * through the agent's `resolveModel`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import {
  collectEvents,
  createAgent,
  createClassicAgent,
  createDefaultInput,
  createFakeModel,
  runClassicAgent,
} from "./agent-test-helpers";
import type { ClassicTestConfig } from "./agent-test-helpers";

/** Runs the agent with `forwardedProps` and returns the one model request. */
async function requestWith(
  config: ClassicTestConfig,
  forwardedProps: RunAgentInput["forwardedProps"],
) {
  const { requests } = await runClassicAgent(config, [{}], { forwardedProps });
  expect(requests).toHaveLength(1);
  return requests[0]!;
}

/** Silences `console.warn` for one test and returns the spy. */
function spyOnWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

/**
 * A classic agent whose `resolveModel` maps `"fast"` to a second fake model.
 * Returns both models' requests, so a test can see which one ran.
 */
function agentWithFastModel(config: ClassicTestConfig = {}) {
  const fast = createFakeModel([{ text: "fast" }, { text: "fast" }]);
  const configured = createClassicAgent(
    {
      overridableProperties: ["model"],
      resolveModel: (name) => (name === "fast" ? fast.model : undefined),
      ...config,
    },
    [{}, {}],
  );
  return {
    agent: configured.agent,
    configuredRequests: configured.requests,
    fastRequests: fast.requests,
  };
}

/** Runs `agent` once per `runIds` entry with `forwardedProps`. */
async function runWith(
  agent: ReturnType<typeof createClassicAgent>["agent"],
  forwardedProps: RunAgentInput["forwardedProps"],
  runIds = ["run1"],
) {
  for (const runId of runIds) {
    await collectEvents(
      agent.run(createDefaultInput({ forwardedProps, runId })),
    );
  }
}

describe("Property overrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("model", () => {
    it("runs the adapter that resolveModel returns for the forwarded name", async () => {
      const { agent, configuredRequests, fastRequests } = agentWithFastModel();

      await runWith(agent, { model: "fast" });

      expect(fastRequests).toHaveLength(1);
      expect(configuredRequests).toHaveLength(0);
    });

    it("a clone keeps resolveModel", async () => {
      const { agent, configuredRequests, fastRequests } = agentWithFastModel();

      await runWith(agent.clone(), { model: "fast" });

      expect(fastRequests).toHaveLength(1);
      expect(configuredRequests).toHaveLength(0);
    });

    it.each([
      [
        "resolveModel returns undefined",
        {},
        "resolveModel returned undefined for it",
      ],
      [
        "the agent has no resolveModel",
        { resolveModel: undefined },
        "the agent has no resolveModel",
      ],
    ])(
      "keeps the configured adapter and warns once when %s",
      async (_case, config, reason) => {
        const warn = spyOnWarn();
        const { agent, configuredRequests } = agentWithFastModel(config);

        await runWith(agent, { model: "slow" }, ["run1", "run2"]);

        expect(configuredRequests).toHaveLength(2);
        expect(warn.mock.calls).toEqual([
          [
            `[CopilotKit] Ignoring the forwarded model "slow": ${reason}. The run uses the configured model adapter.`,
          ],
        ]);
      },
    );

    it.each([
      ["model is not overridable", { overridableProperties: [] }, "fast"],
      ["the forwarded model is not a string", {}, { modelId: "fast" }],
    ])(
      "keeps the configured adapter without a warning when %s",
      async (_case, config, model) => {
        const warn = spyOnWarn();
        const { agent, configuredRequests, fastRequests } =
          agentWithFastModel(config);

        await runWith(agent, { model });

        expect(configuredRequests).toHaveLength(1);
        expect(fastRequests).toHaveLength(0);
        expect(warn).not.toHaveBeenCalled();
      },
    );
  });

  describe("toolChoice", () => {
    const config: ClassicTestConfig = {
      toolChoice: { type: "tool", name: "lookup" },
      overridableProperties: ["toolChoice"],
    };

    it.each(["auto", "required", "none"])(
      "overrides with %j",
      async (toolChoice) => {
        const request = await requestWith(config, { toolChoice });

        expect(request.toolChoice).toBe(toolChoice);
      },
    );

    it("overrides with a specific tool, given in AI SDK shape", async () => {
      const request = await requestWith(
        { ...config, toolChoice: "auto" },
        { toolChoice: { type: "tool", toolName: "specificTool" } },
      );

      expect(request.toolChoice).toEqual({
        type: "tool",
        name: "specificTool",
      });
    });

    it("keeps the configured value for an invalid toolChoice", async () => {
      const request = await requestWith(config, { toolChoice: "invalid" });

      expect(request.toolChoice).toEqual({ type: "tool", name: "lookup" });
    });
  });

  describe("prompt", () => {
    const config: ClassicTestConfig = {
      prompt: "Config prompt.",
      overridableProperties: ["prompt"],
    };

    it("sends the forwarded prompt instead of the configured one", async () => {
      const request = await requestWith(config, {
        prompt: "Forwarded prompt.",
      });

      expect(request.systemPrompts).toEqual(["Forwarded prompt."]);
    });

    it("keeps the configured prompt when the forwarded one is not a string", async () => {
      const request = await requestWith(config, { prompt: 42 });

      expect(request.systemPrompts).toEqual(["Config prompt."]);
    });
  });

  describe("modelOptions", () => {
    const config: ClassicTestConfig = {
      modelOptions: { temperature: 0.5, max_output_tokens: 100 },
      overridableProperties: ["modelOptions"],
    };

    it("replaces the configured modelOptions as a whole, without merging", async () => {
      const request = await requestWith(config, {
        modelOptions: { temperature: 0.9 },
      });

      expect(request.modelOptions).toEqual({ temperature: 0.9 });
    });

    it("keeps the configured modelOptions when the forwarded value is not an object", async () => {
      const request = await requestWith(config, {
        modelOptions: [{ temperature: 0.9 }],
      });

      expect(request.modelOptions).toEqual({
        temperature: 0.5,
        max_output_tokens: 100,
      });
    });

    it("ignores the removed top-level sampling fields", async () => {
      const request = await requestWith(config, {
        temperature: 0.9,
        maxOutputTokens: 500,
      });

      expect(request.modelOptions).toEqual({
        temperature: 0.5,
        max_output_tokens: 100,
      });
    });
  });

  describe("Multiple property overrides", () => {
    const config: ClassicTestConfig = {
      prompt: "Config prompt.",
      toolChoice: "auto",
      modelOptions: { temperature: 0.5 },
      overridableProperties: ["toolChoice"],
    };

    it("only overrides the properties in overridableProperties", async () => {
      const request = await requestWith(config, {
        toolChoice: "none",
        prompt: "Forwarded prompt.",
        modelOptions: { temperature: 0.9 },
      });

      expect(request.toolChoice).toBe("none");
      expect(request.systemPrompts).toEqual(["Config prompt."]);
      expect(request.modelOptions).toEqual({ temperature: 0.5 });
    });

    it.each([
      ["undefined", undefined],
      ["not an object", "not an object"],
    ])(
      "uses the configured values when forwardedProps is %s",
      async (_case, forwardedProps) => {
        const request = await requestWith(
          { ...config, overridableProperties: ["toolChoice", "modelOptions"] },
          forwardedProps,
        );

        expect(request.toolChoice).toBe("auto");
        expect(request.modelOptions).toEqual({ temperature: 0.5 });
      },
    );
  });

  describe("canOverride", () => {
    it("returns true only for the listed properties", () => {
      const { agent } = createClassicAgent({
        overridableProperties: ["prompt", "modelOptions"],
      });

      expect(agent.canOverride("prompt")).toBe(true);
      expect(agent.canOverride("modelOptions")).toBe(true);
      expect(agent.canOverride("model")).toBe(false);
      expect(agent.canOverride("toolChoice")).toBe(false);
    });

    it.each([
      ["overridableProperties is undefined", {}],
      ["overridableProperties is empty", { overridableProperties: [] }],
    ])("returns false when %s", (_case, config) => {
      const { agent } = createClassicAgent(config);

      expect(agent.canOverride("model")).toBe(false);
    });

    it("returns false for a factory agent", () => {
      const agent = createAgent("custom", []);

      expect(agent.canOverride("model")).toBe(false);
    });
  });
});
