import type { EvalConfig } from "./config";
import { isFakeModel } from "./models";

/** Tokens a reply is expected to take, for the estimate. */
export const EXPECTED_OUTPUT_TOKENS = 900;
/** Tokens a judge call takes in and out, for the estimate. */
export const EXPECTED_JUDGE_TOKENS = { input: 2500, output: 120 };

/** The most a reply may take: every model call is capped, so a sample's worst case is known. */
export const MAX_OUTPUT_TOKENS = 8000;
/** The most a judge reply may take, and the most its prompt may be in bytes (the prompt is cut to fit). */
export const MAX_JUDGE_TOKENS = { input: 18000, output: 2000 };
/** Attempts of the judge per sample (one retry). */
export const JUDGE_ATTEMPTS = 2;
/**
 * An upper bound on the tokens of a text: its UTF-8 byte length. A
 * byte-level BPE token covers at least one byte, so no tokenizer of the
 * models we use produces more tokens than bytes, whatever the language.
 */
export const tokenBound = (text: string) => Buffer.byteLength(text, "utf8");

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

/**
 * The most one sample can cost: the prompt (its token upper bound), the capped
 * reply, and every judge attempt at its cap. The runner reserves this
 * before it starts a sample, so the budget holds even when replies run
 * long or the judge retries.
 */
export function worstSampleCost(
  config: EvalConfig,
  model: string,
  judge: string,
  promptTokens: number,
  maxOutputTokens = MAX_OUTPUT_TOKENS,
) {
  return (
    costOf(config, model, promptTokens, maxOutputTokens) +
    JUDGE_ATTEMPTS *
      costOf(config, judge, MAX_JUDGE_TOKENS.input, MAX_JUDGE_TOKENS.output)
  );
}
