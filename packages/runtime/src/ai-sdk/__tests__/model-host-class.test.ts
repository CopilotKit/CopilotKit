/**
 * `aiSdkAgent(...).modelHostClass` for model objects, ported from the classic
 * BuiltInAgent `model-host-class.test.ts`. `aiSdkAgent` reads the endpoint
 * from the provider model's `config` (`baseURL`, or a `url()` builder). The
 * host-to-class table is pinned in `shared/src/telemetry/model-host.test.ts`;
 * OpenAI, Azure, and a model with no `config` are in `agent.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { aiSdkAgent } from "../agent";

/** A mock model shaped like an AI SDK provider model with `config`. */
function providerModel(provider: string, config: object) {
  return Object.assign(new MockLanguageModelV3({ provider }), { config });
}

function urlBuilder(base: string) {
  return {
    url: ({ modelId, path }: { modelId: string; path: string }) =>
      `${base}/models/${modelId}${path}`,
  };
}

describe("aiSdkAgent modelHostClass", () => {
  it.each([
    {
      name: "an Anthropic model on its default baseURL",
      provider: "anthropic.messages",
      config: { baseURL: "https://api.anthropic.com/v1" },
      expected: "anthropic",
    },
    {
      name: "a Google model on its default baseURL",
      provider: "google.generative-ai",
      config: { baseURL: "https://generativelanguage.googleapis.com/v1beta" },
      expected: "google",
    },
    {
      name: "a Vertex model whose url() uses the model id",
      provider: "google.vertex.chat",
      config: urlBuilder(
        "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google",
      ),
      expected: "vertex",
    },
  ])("is $expected for $name", ({ provider, config, expected }) => {
    const agent = aiSdkAgent({ model: providerModel(provider, config) });

    expect(agent.modelHostClass).toBe(expected);
  });

  // Classic read OPENAI_BASE_URL for this. A model object carries its own
  // endpoint, and its "openai.chat" label says nothing about the host.
  it.each([
    { baseUrl: "https://openrouter.ai/api/v1", expected: "openrouter" },
    { baseUrl: "http://localhost:11434/v1", expected: "local" },
    { baseUrl: "https://gateway.acme.example/v1", expected: "other" },
  ])(
    "is $expected for an OpenAI-compatible model aimed at $baseUrl",
    ({ baseUrl, expected }) => {
      const model = providerModel("openai.chat", urlBuilder(baseUrl));

      expect(aiSdkAgent({ model }).modelHostClass).toBe(expected);
    },
  );

  it.each([
    {
      name: "url() throws",
      config: {
        url: () => {
          throw new Error("no url");
        },
      },
    },
    { name: "url() returns no string", config: { url: () => undefined } },
    { name: "config has neither baseURL nor url", config: {} },
  ])("is unknown when $name", ({ config }) => {
    const model = providerModel("openai.chat", config);

    expect(aiSdkAgent({ model }).modelHostClass).toBe("unknown");
  });
});
