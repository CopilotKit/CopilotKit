import { isRecord } from "./converters/usage";

export { isRecord };

/** One type guard per overridable setting, narrowing to that setting's type. */
export type OverrideValidators<T> = {
  [K in keyof T]: (value: unknown) => value is T[K];
};

/** The tool choice values a client can send as an override. */
export type ToolChoiceOverride =
  | "auto"
  | "required"
  | "none"
  | { type: "tool"; toolName: string };

function hasOwn(target: object, key: string) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** True for a number. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** True for an array where every element is a string. */
export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/**
 * True for a tool choice: `"auto"`, `"required"`, `"none"`, or
 * `{ type: "tool", toolName }` with a string `toolName`.
 */
export function isToolChoice(value: unknown): value is ToolChoiceOverride {
  if (value === "auto" || value === "required" || value === "none") {
    return true;
  }
  return (
    isRecord(value) &&
    value.type === "tool" &&
    typeof value.toolName === "string"
  );
}

/**
 * Picks the call settings a client may override from `forwardedProps`.
 *
 * A property is kept only when its name is in `allowed`, it is an own
 * property of `forwardedProps`, and its validator accepts the value.
 * A `forwardedProps` that is not a plain object gives `{}`.
 *
 * @param forwardedProps - The run input's `forwardedProps`, as received.
 * @param allowed - The property names the agent config allows. `undefined` allows none.
 * @param validators - One type guard per property that can be overridden.
 *
 * @example
 * ```ts
 * const overrides = pickOverrides(input.forwardedProps, config.overridableProperties, {
 *   temperature: isNumber,
 *   stopSequences: isStringArray,
 * });
 * streamText({ ...settings, ...overrides });
 * ```
 */
export function pickOverrides<T>(
  forwardedProps: unknown,
  allowed: readonly string[] | undefined,
  validators: OverrideValidators<T>,
) {
  const picked: Partial<T> = {};
  if (!isRecord(forwardedProps) || !allowed) return picked;

  // Object.keys always returns string[]; the keys are exactly the validator keys.
  const keys = Object.keys(validators) as (keyof T & string)[];
  for (const key of keys) {
    const isAllowedAndPresent =
      allowed.includes(key) && hasOwn(forwardedProps, key);
    if (!isAllowedAndPresent) continue;

    const value = forwardedProps[key];
    if (validators[key](value)) {
      picked[key] = value;
    }
  }
  return picked;
}

/**
 * Resolves a `forwardedProps.model` override through a named allowlist.
 *
 * Returns the entry of `models` whose name matches `forwardedProps.model`.
 * Returns `undefined` when `"model"` is not in `allowed`, the value is not a
 * string, or the name is not an own key of `models`.
 *
 * @param forwardedProps - The run input's `forwardedProps`, as received.
 * @param allowed - The property names the agent config allows. `undefined` allows none.
 * @param models - Model names the client may pick, mapped to the model to use.
 *
 * @example
 * ```ts
 * const model =
 *   resolveModelOverride(input.forwardedProps, config.overridableProperties, config.models) ??
 *   config.model;
 * ```
 */
export function resolveModelOverride<M>(
  forwardedProps: unknown,
  allowed: readonly string[] | undefined,
  models: Record<string, M> | undefined,
) {
  const canOverrideModel =
    isRecord(forwardedProps) && !!models && !!allowed?.includes("model");
  if (!canOverrideModel) return undefined;

  const name = forwardedProps.model;
  if (typeof name !== "string" || !hasOwn(models, name)) return undefined;
  return models[name];
}
