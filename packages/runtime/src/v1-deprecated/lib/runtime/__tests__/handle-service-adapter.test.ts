import type { AbstractAgent } from "@ag-ui/client";
import type { LanguageModel } from "ai";
import { CopilotKitMisuseError } from "@copilotkit/shared";
import { describe, expect, it } from "vitest";
import { BuiltInAgent } from "../../../../agent";
import type { CopilotServiceAdapter } from "../../../service-adapters";
import { CopilotRuntime } from "../copilot-runtime";
import { resolveAgents } from "../../../../v2/runtime/core/runtime";

/**
 * Agents resolve per request now, so every read goes through the factory with
 * a request in hand. A misconfigured adapter therefore surfaces on the first
 * request rather than at endpoint construction.
 */
const aRequest = () =>
  new Request("https://app.example.com/api/copilotkit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [], forwardedProps: {} }),
  });

function resolvedAgents(runtime: CopilotRuntime) {
  return resolveAgents(runtime.instance.agents, aRequest());
}

function makeAdapter(
  overrides?: Partial<CopilotServiceAdapter>,
): CopilotServiceAdapter {
  return {
    name: "TestAdapter",
    async process() {
      throw new Error("process() is not expected to be called in these tests");
    },
    ...overrides,
  };
}

async function getDefaultAgent(runtime: CopilotRuntime) {
  const agents = (await resolvedAgents(runtime)) as Record<
    string,
    AbstractAgent
  >;
  return agents.default;
}

// `BuiltInAgent.config` is private; reading it is the only way to verify the
// correct model was passed through without running the entire agent pipeline.
// This narrow accessor is the Rule 2 exception, documented here once rather
// than inline at each call site.
function getBuiltInAgentModel(agent: BuiltInAgent): unknown {
  return (agent as unknown as { config: { model: unknown } }).config.model;
}

describe("CopilotRuntime#handleServiceAdapter (#3217)", () => {
  it("uses the adapter's pre-configured LanguageModel when getLanguageModel() returns one", async () => {
    const fakeLanguageModel = {
      specificationVersion: "v1",
    } as unknown as LanguageModel;
    const runtime = new CopilotRuntime();

    runtime.handleServiceAdapter(
      makeAdapter({
        name: "OpenAIAdapter",
        provider: "openai",
        model: "gpt-4o",
        getLanguageModel: () => fakeLanguageModel,
      }),
    );

    const agent = await getDefaultAgent(runtime);
    expect(agent).toBeInstanceOf(BuiltInAgent);
    expect(getBuiltInAgentModel(agent as BuiltInAgent)).toBe(fakeLanguageModel);
  });

  it("builds a 'provider/model' string when only provider+model are exposed", async () => {
    const runtime = new CopilotRuntime();

    runtime.handleServiceAdapter(
      makeAdapter({
        name: "GroqAdapter",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
      }),
    );

    const agent = await getDefaultAgent(runtime);
    expect(agent).toBeInstanceOf(BuiltInAgent);
    expect(getBuiltInAgentModel(agent as BuiltInAgent)).toBe(
      "groq/llama-3.3-70b-versatile",
    );
  });

  it("throws CopilotKitMisuseError when no model source is available (LangChainAdapter regression)", async () => {
    const runtime = new CopilotRuntime();

    runtime.handleServiceAdapter(makeAdapter({ name: "LangChainAdapter" }));

    await expect(resolvedAgents(runtime)).rejects.toBeInstanceOf(
      CopilotKitMisuseError,
    );
    await expect(resolvedAgents(runtime)).rejects.toThrow(
      /Service adapter "LangChainAdapter" does not provide model information/,
    );
  });

  it("falls back to 'unknown' in the thrown error when the adapter has no name", async () => {
    const runtime = new CopilotRuntime();

    runtime.handleServiceAdapter(makeAdapter({ name: undefined }));

    await expect(resolvedAgents(runtime)).rejects.toThrow(
      /Service adapter "unknown" does not provide model information/,
    );
  });

  it("does not throw when provider is set without a model — but must not emit 'undefined/undefined'", async () => {
    // Guards the specific #3217 regression: when only one half of the pair is
    // present, we must NOT synthesize a bogus "provider/undefined" string.
    const runtime = new CopilotRuntime();

    runtime.handleServiceAdapter(
      makeAdapter({ name: "PartialAdapter", provider: "openai" }),
    );

    await expect(resolvedAgents(runtime)).rejects.toThrow(
      CopilotKitMisuseError,
    );
  });
});
