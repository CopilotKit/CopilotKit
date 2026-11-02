/**
 * `aiSdkAgent` `overridableProperties`: which `forwardedProps` values reach
 * the model call. The validators themselves are unit-tested in
 * `agent/__tests__/overrides.test.ts`; these tests pin the agent wiring.
 */
import { describe, expect, it } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { BuiltInAgent } from "../../agent";
import {
  collectEventsIncludingErrors,
  createDefaultInput,
} from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import type { AiSdkAgentConfig } from "../agent";
import { modelEmitting, textTurn } from "./mock-model";

function textModel() {
  return modelEmitting(textTurn("ok"));
}

/** Runs one turn with `forwardedProps`. A failed run does not throw. */
function runTurn(
  agent: BuiltInAgent,
  forwardedProps: RunAgentInput["forwardedProps"],
) {
  return collectEventsIncludingErrors(
    agent.run(
      createDefaultInput({
        messages: [{ id: "u1", role: "user", content: "hi" }],
        forwardedProps,
      }),
    ),
  );
}

/**
 * Runs one turn with `forwardedProps` and returns the options the model
 * received. `config` must not set `model`; the mock model is added here.
 */
async function modelCallWith(
  config: Omit<AiSdkAgentConfig, "model">,
  forwardedProps: RunAgentInput["forwardedProps"],
) {
  const model = textModel();
  await runTurn(aiSdkAgent({ ...config, model }), forwardedProps);
  return model.doStreamCalls[0];
}

describe("aiSdkAgent forwardedProps overrides", () => {
  it("passes every allowed call setting to the model", async () => {
    const call = await modelCallWith(
      {
        maxOutputTokens: 100,
        temperature: 0.5,
        topP: 0.9,
        topK: 50,
        presencePenalty: 0,
        frequencyPenalty: 0,
        seed: 123,
        stopSequences: ["STOP"],
        overridableProperties: [
          "maxOutputTokens",
          "temperature",
          "topP",
          "topK",
          "presencePenalty",
          "frequencyPenalty",
          "seed",
          "stopSequences",
          "providerOptions",
        ],
      },
      {
        maxOutputTokens: 500,
        temperature: 0.8,
        topP: 0.95,
        topK: 100,
        presencePenalty: 0.5,
        frequencyPenalty: 0.5,
        seed: 456,
        stopSequences: ["END", "FINISH"],
        providerOptions: { openai: { reasoningEffort: "low" } },
      },
    );

    expect(call).toMatchObject({
      maxOutputTokens: 500,
      temperature: 0.8,
      topP: 0.95,
      topK: 100,
      presencePenalty: 0.5,
      frequencyPenalty: 0.5,
      seed: 456,
      stopSequences: ["END", "FINISH"],
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
  });

  it("overrides maxRetries, so a retryable model error is tried that many more times", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new APICallError({
          message: "Overloaded",
          url: "https://api.provider.example/v1/chat",
          requestBodyValues: {},
          statusCode: 503,
          // Retry at once instead of after the default 2 s backoff.
          responseHeaders: { "retry-after-ms": "0" },
          isRetryable: true,
        });
      },
    });
    const agent = aiSdkAgent({
      model,
      maxRetries: 0,
      overridableProperties: ["maxRetries"],
    });

    await runTurn(agent, { maxRetries: 2 });

    expect(model.doStreamCalls).toHaveLength(3);
  });

  it.each([
    { name: "auto", toolChoice: "auto", expected: { type: "auto" } },
    { name: "none", toolChoice: "none", expected: { type: "none" } },
    {
      name: "required",
      toolChoice: "required",
      expected: { type: "required" },
    },
    {
      name: "a specific tool",
      toolChoice: { type: "tool", toolName: "AGUISendStateSnapshot" },
      expected: { type: "tool", toolName: "AGUISendStateSnapshot" },
    },
  ])("overrides toolChoice with $name", async ({ toolChoice, expected }) => {
    const call = await modelCallWith(
      {
        toolChoice: toolChoice === "required" ? "auto" : "required",
        overridableProperties: ["toolChoice"],
      },
      { toolChoice },
    );

    expect(call.toolChoice).toEqual(expected);
  });

  it("overrides only the allowed properties", async () => {
    const call = await modelCallWith(
      {
        temperature: 0.5,
        topP: 0.9,
        maxOutputTokens: 100,
        overridableProperties: ["temperature"],
      },
      { temperature: 0.9, topP: 0.5, maxOutputTokens: 500 },
    );

    expect(call).toMatchObject({
      temperature: 0.9,
      topP: 0.9,
      maxOutputTokens: 100,
    });
  });

  it.each([
    { name: "no forwardedProps", forwardedProps: undefined },
    { name: "a non-object forwardedProps", forwardedProps: "not an object" },
    { name: "an undefined value", forwardedProps: { temperature: undefined } },
    { name: "a non-number value", forwardedProps: { temperature: "high" } },
  ])(
    "keeps the configured temperature for $name",
    async ({ forwardedProps }) => {
      const call = await modelCallWith(
        { temperature: 0.5, overridableProperties: ["temperature"] },
        forwardedProps,
      );

      expect(call.temperature).toBe(0.5);
    },
  );

  it.each([
    {
      name: "an invalid toolChoice",
      config: { toolChoice: "auto" },
      forwardedProps: { toolChoice: "invalid" },
      expected: { toolChoice: { type: "auto" } },
    },
    {
      name: "stopSequences with a non-string element",
      config: { stopSequences: ["STOP"] },
      forwardedProps: { stopSequences: ["STOP", 123, "END"] },
      expected: { stopSequences: ["STOP"] },
    },
    {
      name: "stopSequences that is not an array",
      config: { stopSequences: ["STOP"] },
      forwardedProps: { stopSequences: "END" },
      expected: { stopSequences: ["STOP"] },
    },
    {
      name: "providerOptions whose entry is not an object",
      config: { providerOptions: { openai: { user: "config" } } },
      forwardedProps: { providerOptions: { openai: "low" } },
      expected: { providerOptions: { openai: { user: "config" } } },
    },
  ] satisfies Array<{
    name: string;
    config: Omit<AiSdkAgentConfig, "model">;
    forwardedProps: RunAgentInput["forwardedProps"];
    expected: Record<string, unknown>;
  }>)(
    "keeps the configured value for $name",
    async ({ config, forwardedProps, expected }) => {
      const call = await modelCallWith(
        {
          ...config,
          overridableProperties: [
            "toolChoice",
            "stopSequences",
            "providerOptions",
          ],
        },
        forwardedProps,
      );

      expect(call).toMatchObject(expected);
    },
  );
});

describe("aiSdkAgent model override", () => {
  // `models` (named allowlist) switching and unknown names are covered in
  // agent.test.ts. Classic accepted a model instance or a "provider/model"
  // string from the client; aiSdkAgent takes only a name from `models`.
  it.each([
    { name: "a model object", model: { modelId: "custom", provider: "x" } },
    { name: "a number", model: 123 },
  ])(
    "ignores $name in forwardedProps.model and keeps the configured model",
    async ({ model: requested }) => {
      const model = textModel();
      const fast = textModel();
      const agent = aiSdkAgent({
        model,
        models: { fast },
        overridableProperties: ["model"],
      });

      await runTurn(agent, { model: requested });

      expect(model.doStreamCalls).toHaveLength(1);
      expect(fast.doStreamCalls).toHaveLength(0);
    },
  );

  it("keeps the configured model when model is not an overridable property", async () => {
    const model = textModel();
    const fast = textModel();
    const agent = aiSdkAgent({
      model,
      models: { fast },
      overridableProperties: ["temperature"],
    });

    await runTurn(agent, { model: "fast" });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(fast.doStreamCalls).toHaveLength(0);
  });
});
