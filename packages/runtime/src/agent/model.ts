import { isRecord } from "./converters/usage";

/**
 * Whether a value is an AI SDK `LanguageModel` object (for example
 * `openai("gpt-5")` from `@ai-sdk/openai`). It checks the shape only, so it
 * loads no AI SDK package.
 *
 * @param value - The value passed as `model`.
 * @returns `true` when the value has `specificationVersion` and a
 *   `doStream` or `doGenerate` method.
 *
 * @example
 * ```ts
 * if (isAISDKLanguageModel(config.model)) throw new Error("...");
 * ```
 */
export function isAISDKLanguageModel(value: unknown) {
  if (!isRecord(value)) return false;
  const hasModelMethod =
    typeof value.doStream === "function" ||
    typeof value.doGenerate === "function";
  return "specificationVersion" in value && hasModelMethod;
}

/**
 * Throws when a classic config's `model` is not a TanStack AI text adapter.
 * The types already require an adapter; this catches the two wrong values a
 * JavaScript caller (or a cast) can still pass: a model string, and an AI SDK
 * model object. Each error names the fix.
 */
export function assertTextAdapter(value: unknown) {
  if (typeof value === "string") {
    throw new Error(
      `BuiltInAgent "model" got the string ${JSON.stringify(value)}. Pass a TanStack AI text adapter instead, such as openaiText("gpt-5") from "@tanstack/ai-openai".`,
    );
  }
  if (isAISDKLanguageModel(value)) {
    throw new Error(
      'BuiltInAgent "model" got an AI SDK model object. Run AI SDK models with a factory: new BuiltInAgent({ type: "aisdk", factory: ... }), with the helpers in "@copilotkit/runtime/agent/ai-sdk". Or pass a TanStack AI text adapter such as openaiText("gpt-5") from "@tanstack/ai-openai".',
    );
  }
}
