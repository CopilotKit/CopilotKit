/**
 * `forwardedProps` overrides. A run may replace `model`, `toolChoice`,
 * `prompt`, or `modelOptions`, but only the ones the agent lists in
 * `overridableProperties`, and only with a value of the right shape. The
 * fake model records what `chat()` sent it; the forwarded-model test stubs
 * `fetch` at the network boundary to see the request the real adapter makes.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import {
  collectEventsIncludingErrors,
  createAgent,
  createClassicAgent,
  createDefaultInput,
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

/** Stubs the Anthropic API and records the body of each request to it. */
function stubAnthropicApi() {
  const sent: { url: string; body: unknown }[] = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(
        { type: "error", error: { type: "api_error", message: "stubbed" } },
        { status: 400 },
      );
    }),
  );
  return sent;
}

describe("Property overrides", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("model", () => {
    const forwardedProps = { model: "anthropic/claude-sonnet-4-5" };

    it("runs a forwarded model string instead of the configured model", async () => {
      const sent = stubAnthropicApi();
      const { agent, requests } = createClassicAgent(
        { overridableProperties: ["model"] },
        [{ text: "fake" }],
      );

      await collectEventsIncludingErrors(
        agent.run(
          createDefaultInput({
            forwardedProps,
            messages: [{ id: "u1", role: "user", content: "Hi" }],
          }),
        ),
      );

      expect(requests).toHaveLength(0);
      expect(sent).toEqual([
        {
          url: expect.stringMatching(/^https:\/\/api\.anthropic\.com\/v1\//),
          body: expect.objectContaining({ model: "claude-sonnet-4-5" }),
        },
      ]);
    });

    it.each([
      ["model is not overridable", {}, forwardedProps],
      [
        "the forwarded model is not a string",
        { overridableProperties: ["model" as const] },
        { model: { modelId: "custom-model", provider: "custom" } },
      ],
    ])(
      "keeps the configured model when %s",
      async (_case, config, props) => {
        const sent = stubAnthropicApi();

        await requestWith(config, props);

        expect(sent).toEqual([]);
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

      expect(request.toolChoice).toEqual({ type: "tool", name: "specificTool" });
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
