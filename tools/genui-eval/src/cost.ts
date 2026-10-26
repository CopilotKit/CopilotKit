import type { EvalConfig } from "./config";
import { isFakeModel } from "./models";

/** Tokens a reply is expected to take, for the estimate. */
export const EXPECTED_OUTPUT_TOKENS = 900;
/** Tokens a judge call takes in and out, for the estimate. */
export const EXPECTED_JUDGE_TOKENS = { input: 2500, output: 120 };

/** USD per million tokens of a model. Fakes are free unless the config prices them. */
export function priceOf(config: EvalConfig, model: string) {
  const listed = config.prices[model];
  if (listed) return listed;
  return isFakeModel(model) ? { input: 0, output: 0 } : config.defaultPrice;
}

/** The cost of a call from its tokens. */
export function costOf(
  config: EvalConfig,
  model: string,
  input: number,
  output: number,
) {
  const price = priceOf(config, model);
  return (input * price.input + output * price.output) / 1_000_000;
}

/**
 * The estimated cost of one sample: the model call with the prompt of its
 * transport plus the judge call.
 */
export function estimateSampleCost(
  config: EvalConfig,
  model: string,
  judge: string,
  promptTokens: number,
) {
  return (
    costOf(config, model, promptTokens, EXPECTED_OUTPUT_TOKENS) +
    costOf(
      config,
      judge,
      EXPECTED_JUDGE_TOKENS.input,
      EXPECTED_JUDGE_TOKENS.output,
    )
  );
}
